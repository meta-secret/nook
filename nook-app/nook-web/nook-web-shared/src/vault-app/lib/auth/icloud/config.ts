/**
 * Nook iCloud CloudKit — browser-only web auth (CloudKit JS).
 *
 * CloudKit Console → Production → iCloud.metasecret.project.com:
 * - API token (Settings -> Tokens & Keys), allowed origins https://nokey.sh,
 *   https://simple.nokey.sh, https://sentinel.nokey.sh,
 *   https://simple.dev.nokey.sh, and https://sentinel.dev.nokey.sh
 * - Schema: NookLogEvent record type with location, event_id and content
 *   (String), Queryable indexes on recordName, location and event_id,
 *   deployed to Production. `location` holds the log's namespace tag
 *   (`vault:<store>` or `identity:<id>`).
 * - Sign in with Apple via CloudKit JS setUpAuth (Post Message callback)
 */
import { CloudKitEnvironment } from "$lib/auth/icloud/cloudkit-state";

export const ICLOUD_CONTAINER_ID = "iCloud.metasecret.project.com";
export const ICLOUD_API_TOKEN =
  "c31649c685f5f589c1c66f867ab2c013b6765d01e6bda454ec28d246ca4dc7d0";
export const ICLOUD_ENVIRONMENT = CloudKitEnvironment.Production;
