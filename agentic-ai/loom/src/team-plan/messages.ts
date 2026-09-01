import english from '../../locales/en.json';
import russian from '../../locales/ru.json';

export type TeamPlanMessages = Readonly<{
  help: string;
  invalidArguments: string;
  invalidRecordFile: string;
  invalidRecordJson: string;
  invalidRecordContents: string;
  invalidRecordEncoding: string;
  oversizedRecord: string;
  runtimeValidationFailure: string;
  runtimeStorageFailure: string;
  runtimeRecoveryFailure: string;
  runtimeCommandFailure: string;
}>;

export function teamPlanMessages(locale: string): TeamPlanMessages {
  const normalized = locale
    .trim()
    .toLocaleLowerCase()
    .replaceAll('_', '-')
    .split('.')[0];
  let catalog: typeof english;
  if (
    normalized === 'c' ||
    normalized === 'posix' ||
    normalized === 'en' ||
    normalized?.startsWith('en-')
  )
    catalog = english;
  else if (normalized === 'ru' || normalized?.startsWith('ru-'))
    catalog = russian;
  else throw new Error(`Unsupported Team Plan locale: ${locale}`);
  return {
    help: catalog.team_plan_help,
    invalidArguments: catalog.team_plan_invalid_arguments,
    invalidRecordFile: catalog.team_plan_invalid_record_file,
    invalidRecordJson: catalog.team_plan_invalid_record_json,
    invalidRecordContents: catalog.team_plan_invalid_record_contents,
    invalidRecordEncoding: catalog.team_plan_invalid_record_encoding,
    oversizedRecord: catalog.team_plan_oversized_record,
    runtimeValidationFailure: catalog.team_plan_runtime_validation_failure,
    runtimeStorageFailure: catalog.team_plan_runtime_storage_failure,
    runtimeRecoveryFailure: catalog.team_plan_runtime_recovery_failure,
    runtimeCommandFailure: catalog.team_plan_runtime_command_failure,
  };
}
