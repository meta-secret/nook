import english from '../../locales/en.json';
import russian from '../../locales/ru.json';

export type TeamPlanMessages = Readonly<{
  help: string;
  invalidArguments: string;
  invalidRecordFile: string;
  invalidRecordJson: string;
  invalidRecordEncoding: string;
  oversizedRecord: string;
}>;

export function teamPlanMessages(locale: string): TeamPlanMessages {
  const catalog = locale.toLocaleLowerCase().startsWith('ru')
    ? russian
    : english;
  return {
    help: catalog.team_plan_help,
    invalidArguments: catalog.team_plan_invalid_arguments,
    invalidRecordFile: catalog.team_plan_invalid_record_file,
    invalidRecordJson: catalog.team_plan_invalid_record_json,
    invalidRecordEncoding: catalog.team_plan_invalid_record_encoding,
    oversizedRecord: catalog.team_plan_oversized_record,
  };
}
