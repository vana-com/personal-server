export {
  fileRegistrationDomain,
  grantRegistrationDomain,
  grantRevocationDomain,
  serverRegistrationDomain,
  FILE_REGISTRATION_TYPES,
  GRANT_REGISTRATION_TYPES,
  GRANT_REVOCATION_TYPES,
  SERVER_REGISTRATION_TYPES,
  type FileRegistrationMessage,
  type GrantRegistrationMessage,
  type GrantRevocationMessage,
  type ServerRegistrationMessage,
} from "./eip712.js";

export { createServerSigner, type ServerSigner } from "./signer.js";
