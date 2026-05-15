/**
 * Tenants servisas — organizacijų sąrašas. Read-only, visiems autentifikuotiems.
 */
import type { ServiceSchema } from 'moleculer';
import type { Tenant as TenantDTO } from '@biip-finansai/shared';
import { Tenant } from '../models/Tenant';

function toDTO(t: Tenant): TenantDTO {
  return {
    id: t.id,
    code: t.code,
    name: t.name,
    isApprover: t.isApprover,
    active: t.active,
  };
}

const TenantsService: ServiceSchema = {
  name: 'tenants',

  actions: {
    list: {
      async handler(): Promise<TenantDTO[]> {
        const tenants = await Tenant.query().orderBy('code');
        return tenants.map(toDTO);
      },
    },
  },
};

export default TenantsService;
