export {
  deriveMasterKey,
  deriveScopeKey,
  recoverServerOwner,
} from "./derive.js";

export {
  loadOrCreateServerAccount,
  type ServerAccount,
  type SignTypedDataParams,
} from "./server-account.js";
