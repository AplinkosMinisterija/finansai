/**
 * Klasifikatorių servisas.
 *
 * - list/get: visi autentifikuoti (dropdown'ams reikia).
 * - create/update/delete: tik aprover tenant'o `admin` (AM admin).
 *
 * Du resource'ai: groups ir items. Items priklauso grupei (group_id) ir
 * gali turėti tėvinį item'ą (parent_id, sub-categorija).
 */
import type { ServiceSchema, Context } from 'moleculer';
import { Errors } from 'moleculer';
import type {
  ClassifierGroup as GroupDTO,
  ClassifierItem as ItemDTO,
  ClassifierGroupCreateRequest,
  ClassifierGroupUpdateRequest,
  ClassifierItemCreateRequest,
  ClassifierItemUpdateRequest,
} from '@biip-finansai/shared';
import { ClassifierGroup } from '../models/ClassifierGroup';
import { ClassifierItem } from '../models/ClassifierItem';
import type { AuthMeta } from './auth.service';

/**
 * Sistemos klasifikatorių grupių kodai — šios grupės būtinos sistemos
 * veikimui (biudžeto skaidymas, IS dropdown, šaltinio programos, tvirtinimo
 * lygiai). Trinti jas negalima — sulaužytų logiką. Audit #12.
 */
const SYSTEM_GROUP_CODES = [
  'funding_type',
  'is_system',
  'project_type',
  'source_program',
  'approval_levels',
] as const;

type SystemGroupCode = (typeof SYSTEM_GROUP_CODES)[number];

function isSystemGroupCode(code: string): code is SystemGroupCode {
  return (SYSTEM_GROUP_CODES as readonly string[]).includes(code);
}

/**
 * UAT #42 (PA-005): leistinos cross-group parent kombinacijos.
 *
 * Įprastai item'o tėvas turi būti tos pačios grupės (hierarchija grupėje). Bet
 * `source_program` reikšmės gali turėti tėvą iš `funding_source_type` grupės —
 * taip programa susiejama su finansavimo šaltinio tipu (šaltinis → programa).
 *
 * Grąžina `true`, jei child grupė `childGroupCode` leidžia parent'ą iš
 * grupės `parentGroupCode`.
 */
function isAllowedCrossGroupParent(childGroupCode: string, parentGroupCode: string): boolean {
  return childGroupCode === 'source_program' && parentGroupCode === 'funding_source_type';
}

function toGroupDTO(g: ClassifierGroup, itemsCount?: number): GroupDTO {
  return {
    id: g.id,
    code: g.code,
    name: g.name,
    description: g.description,
    active: g.active,
    itemsCount,
  };
}

function toItemDTO(i: ClassifierItem, groupCode?: string): ItemDTO {
  return {
    id: i.id,
    groupId: i.groupId,
    groupCode,
    parentId: i.parentId,
    code: i.code,
    name: i.name,
    sortOrder: i.sortOrder,
    active: i.active,
  };
}

function requireMe(ctx: Context<unknown, AuthMeta>): NonNullable<AuthMeta['user']> {
  if (!ctx.meta.user) {
    throw new Errors.MoleculerClientError('Neautentifikuota', 401, 'AUTH_REQUIRED');
  }
  return ctx.meta.user;
}

function requireSuperAdmin(me: NonNullable<AuthMeta['user']>): void {
  if (!me.tenantIsApprover || me.role !== 'admin') {
    throw new Errors.MoleculerClientError(
      'Šis veiksmas leidžiamas tik AM administratoriui',
      403,
      'FORBIDDEN',
    );
  }
}

const ClassifiersService: ServiceSchema = {
  name: 'classifiers',

  actions: {
    // ---------- Groups ----------

    listGroups: {
      params: {
        withCounts: { type: 'boolean', optional: true, convert: true, default: false },
      },
      async handler(ctx: Context<{ withCounts?: boolean }, AuthMeta>): Promise<GroupDTO[]> {
        requireMe(ctx);
        const groups = await ClassifierGroup.query().orderBy('code', 'asc');
        if (!ctx.params.withCounts) {
          return groups.map((g) => toGroupDTO(g));
        }
        const counts = (await ClassifierItem.query()
          .select('group_id')
          .count('* as count')
          .groupBy('group_id')) as unknown as Array<{ groupId: number; count: string }>;
        const map = new Map(counts.map((c) => [c.groupId, Number(c.count)]));
        return groups.map((g) => toGroupDTO(g, map.get(g.id) ?? 0));
      },
    },

    getGroup: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<GroupDTO> {
        requireMe(ctx);
        const g = await ClassifierGroup.query().findById(ctx.params.id);
        if (!g) {
          throw new Errors.MoleculerClientError('Grupė nerasta', 404, 'GROUP_NOT_FOUND');
        }
        return toGroupDTO(g);
      },
    },

    createGroup: {
      params: {
        code: { type: 'string', min: 1, max: 64 },
        name: { type: 'string', min: 1, max: 200 },
        description: { type: 'string', optional: true, nullable: true, max: 2000 },
        active: { type: 'boolean', optional: true, default: true },
      },
      async handler(ctx: Context<ClassifierGroupCreateRequest, AuthMeta>): Promise<GroupDTO> {
        const me = requireMe(ctx);
        requireSuperAdmin(me);
        const p = ctx.params;
        const exists = await ClassifierGroup.query().findOne({ code: p.code });
        if (exists) {
          throw new Errors.MoleculerClientError(
            'Tokio kodo grupė jau egzistuoja',
            409,
            'GROUP_CODE_TAKEN',
          );
        }
        const inserted = await ClassifierGroup.query().insert({
          code: p.code,
          name: p.name,
          description: p.description ?? null,
          active: p.active ?? true,
        });
        return toGroupDTO(inserted);
      },
    },

    updateGroup: {
      params: {
        id: { type: 'number', integer: true, convert: true },
        code: { type: 'string', optional: true, min: 1, max: 64 },
        name: { type: 'string', optional: true, min: 1, max: 200 },
        description: { type: 'string', optional: true, nullable: true, max: 2000 },
        active: { type: 'boolean', optional: true },
      },
      async handler(
        ctx: Context<ClassifierGroupUpdateRequest & { id: number }, AuthMeta>,
      ): Promise<GroupDTO> {
        const me = requireMe(ctx);
        requireSuperAdmin(me);
        const target = await ClassifierGroup.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError('Grupė nerasta', 404, 'GROUP_NOT_FOUND');
        }
        const p = ctx.params;
        if (p.code !== undefined && p.code !== target.code) {
          const exists = await ClassifierGroup.query().findOne({ code: p.code });
          if (exists) {
            throw new Errors.MoleculerClientError(
              'Tokio kodo grupė jau egzistuoja',
              409,
              'GROUP_CODE_TAKEN',
            );
          }
        }
        const patch: Record<string, unknown> = {};
        if (p.code !== undefined) patch['code'] = p.code;
        if (p.name !== undefined) patch['name'] = p.name;
        if (p.description !== undefined) patch['description'] = p.description;
        if (p.active !== undefined) patch['active'] = p.active;
        await ClassifierGroup.query().findById(target.id).patch(patch);
        const updated = await ClassifierGroup.query().findById(target.id);
        if (!updated) throw new Error('Updated group not found');
        return toGroupDTO(updated);
      },
    },

    deleteGroup: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<{ ok: true }> {
        const me = requireMe(ctx);
        requireSuperAdmin(me);
        const target = await ClassifierGroup.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError('Grupė nerasta', 404, 'GROUP_NOT_FOUND');
        }
        if (isSystemGroupCode(target.code)) {
          throw new Errors.MoleculerClientError(
            'Sistemos grupę ištrinti negalima — sistema priklauso nuo šio klasifikatoriaus',
            400,
            'SYSTEM_GROUP_LOCKED',
          );
        }
        await ClassifierGroup.query().deleteById(target.id);
        return { ok: true };
      },
    },

    // ---------- Items ----------

    listItems: {
      params: {
        groupId: { type: 'number', integer: true, optional: true, convert: true },
        groupCode: { type: 'string', optional: true },
        includeInactive: {
          type: 'boolean',
          optional: true,
          convert: true,
          default: false,
        },
      },
      async handler(
        ctx: Context<{ groupId?: number; groupCode?: string; includeInactive?: boolean }, AuthMeta>,
      ): Promise<ItemDTO[]> {
        requireMe(ctx);
        let groupId = ctx.params.groupId;
        let group: ClassifierGroup | undefined;
        if (groupId === undefined && ctx.params.groupCode) {
          group = await ClassifierGroup.query().findOne({ code: ctx.params.groupCode });
          if (!group) {
            return [];
          }
          groupId = group.id;
        } else if (groupId !== undefined) {
          group = await ClassifierGroup.query().findById(groupId);
        }
        const q = ClassifierItem.query().orderBy([
          { column: 'parent_id', order: 'asc', nulls: 'first' },
          { column: 'sort_order', order: 'asc' },
          { column: 'name', order: 'asc' },
        ]);
        if (groupId !== undefined) q.where('group_id', groupId);
        if (!ctx.params.includeInactive) q.where('active', true);
        const items = await q;
        return items.map((i) => toItemDTO(i, group?.code));
      },
    },

    getItem: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<ItemDTO> {
        requireMe(ctx);
        const i = await ClassifierItem.query().findById(ctx.params.id);
        if (!i) {
          throw new Errors.MoleculerClientError('Reikšmė nerasta', 404, 'ITEM_NOT_FOUND');
        }
        return toItemDTO(i);
      },
    },

    createItem: {
      params: {
        groupId: { type: 'number', integer: true, convert: true },
        parentId: { type: 'number', integer: true, optional: true, nullable: true, convert: true },
        code: { type: 'string', min: 1, max: 64 },
        name: { type: 'string', min: 1, max: 200 },
        sortOrder: { type: 'number', integer: true, optional: true, convert: true, default: 0 },
        active: { type: 'boolean', optional: true, default: true },
      },
      async handler(ctx: Context<ClassifierItemCreateRequest, AuthMeta>): Promise<ItemDTO> {
        const me = requireMe(ctx);
        requireSuperAdmin(me);
        const p = ctx.params;
        const group = await ClassifierGroup.query().findById(p.groupId);
        if (!group) {
          throw new Errors.MoleculerClientError('Grupė nerasta', 404, 'GROUP_NOT_FOUND');
        }
        if (p.parentId) {
          const parent = await ClassifierItem.query()
            .findById(p.parentId)
            .withGraphFetched('group');
          const parentGroupCode = (
            parent as ClassifierItem & {
              group?: ClassifierGroup;
            }
          )?.group?.code;
          const sameGroup = parent && parent.groupId === p.groupId;
          const crossOk =
            parent &&
            parentGroupCode !== undefined &&
            isAllowedCrossGroupParent(group.code, parentGroupCode);
          if (!parent || (!sameGroup && !crossOk)) {
            throw new Errors.MoleculerClientError(
              'Tėvinė reikšmė priklauso kitai grupei',
              400,
              'INVALID_PARENT',
            );
          }
        }
        const exists = await ClassifierItem.query()
          .where({ group_id: p.groupId, code: p.code })
          .first();
        if (exists) {
          throw new Errors.MoleculerClientError(
            'Toks reikšmės kodas grupėje jau egzistuoja',
            409,
            'ITEM_CODE_TAKEN',
          );
        }
        const inserted = await ClassifierItem.query().insert({
          groupId: p.groupId,
          parentId: p.parentId ?? null,
          code: p.code,
          name: p.name,
          sortOrder: p.sortOrder ?? 0,
          active: p.active ?? true,
        });
        return toItemDTO(inserted, group.code);
      },
    },

    updateItem: {
      params: {
        id: { type: 'number', integer: true, convert: true },
        parentId: { type: 'number', integer: true, optional: true, nullable: true, convert: true },
        code: { type: 'string', optional: true, min: 1, max: 64 },
        name: { type: 'string', optional: true, min: 1, max: 200 },
        sortOrder: { type: 'number', integer: true, optional: true, convert: true },
        active: { type: 'boolean', optional: true },
      },
      async handler(
        ctx: Context<ClassifierItemUpdateRequest & { id: number }, AuthMeta>,
      ): Promise<ItemDTO> {
        const me = requireMe(ctx);
        requireSuperAdmin(me);
        const target = await ClassifierItem.query()
          .findById(ctx.params.id)
          .withGraphFetched('group');
        if (!target) {
          throw new Errors.MoleculerClientError('Reikšmė nerasta', 404, 'ITEM_NOT_FOUND');
        }
        const targetGroupCode = (
          target as ClassifierItem & {
            group?: ClassifierGroup;
          }
        ).group?.code;
        const p = ctx.params;
        if (p.parentId !== undefined && p.parentId !== null) {
          if (p.parentId === target.id) {
            throw new Errors.MoleculerClientError(
              'Reikšmė negali būti pati savo tėvas',
              400,
              'INVALID_PARENT',
            );
          }
          const parent = await ClassifierItem.query()
            .findById(p.parentId)
            .withGraphFetched('group');
          const parentGroupCode = (
            parent as ClassifierItem & {
              group?: ClassifierGroup;
            }
          )?.group?.code;
          const sameGroup = parent && parent.groupId === target.groupId;
          const crossOk =
            parent &&
            parentGroupCode !== undefined &&
            targetGroupCode !== undefined &&
            isAllowedCrossGroupParent(targetGroupCode, parentGroupCode);
          if (!parent || (!sameGroup && !crossOk)) {
            throw new Errors.MoleculerClientError(
              'Tėvinė reikšmė priklauso kitai grupei',
              400,
              'INVALID_PARENT',
            );
          }
        }
        if (p.code !== undefined && p.code !== target.code) {
          const exists = await ClassifierItem.query()
            .where({ group_id: target.groupId, code: p.code })
            .first();
          if (exists) {
            throw new Errors.MoleculerClientError(
              'Toks reikšmės kodas grupėje jau egzistuoja',
              409,
              'ITEM_CODE_TAKEN',
            );
          }
        }
        const patch: Record<string, unknown> = {};
        if (p.parentId !== undefined) patch['parentId'] = p.parentId;
        if (p.code !== undefined) patch['code'] = p.code;
        if (p.name !== undefined) patch['name'] = p.name;
        if (p.sortOrder !== undefined) patch['sortOrder'] = p.sortOrder;
        if (p.active !== undefined) patch['active'] = p.active;
        await ClassifierItem.query().findById(target.id).patch(patch);
        const updated = await ClassifierItem.query().findById(target.id);
        if (!updated) throw new Error('Updated item not found');
        return toItemDTO(updated);
      },
    },

    deleteItem: {
      params: { id: { type: 'number', integer: true, convert: true } },
      async handler(ctx: Context<{ id: number }, AuthMeta>): Promise<{ ok: true }> {
        const me = requireMe(ctx);
        requireSuperAdmin(me);
        const target = await ClassifierItem.query().findById(ctx.params.id);
        if (!target) {
          throw new Errors.MoleculerClientError('Reikšmė nerasta', 404, 'ITEM_NOT_FOUND');
        }
        await ClassifierItem.query().deleteById(target.id);
        return { ok: true };
      },
    },
  },
};

export default ClassifiersService;
