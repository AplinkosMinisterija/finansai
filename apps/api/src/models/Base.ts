/**
 * Pagrindinė Objection.js modelio bazė.
 *
 * - Naudoja `snakeCaseMappers` — DB lieka snake_case, modelis camelCase.
 * - Automatiškai atnaujina `updated_at` per `$beforeUpdate`.
 */
import { Model, snakeCaseMappers, type ColumnNameMappers } from 'objection';

export abstract class BaseModel extends Model {
  static override get columnNameMappers(): ColumnNameMappers {
    return snakeCaseMappers();
  }

  // Visiems modeliams (kurie turi updated_at) — automatiškai atnaujinti.
  // Modeliai be `updated_at` (pvz. EmployeeSkill) tiesiog nieko neturės šitam lauke.
  override $beforeUpdate(): void {
    // Tipas any — Objection neturi typed instance žinybų base klasėje.
    (this as unknown as Record<string, unknown>)['updatedAt'] =
      new Date().toISOString();
  }
}
