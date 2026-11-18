// Same rule as Delhivery's loginErrors — only true Keycloak-rejected creds
// count as INVALID_CREDENTIALS. Everything else is transient.

const {
	INVALID_CREDENTIALS_PREFIX,
	isInvalidCredentialsError,
} = require("../../../common/credentialErrors");


module.exports = { isInvalidCredentialsError, INVALID_CREDENTIALS_PREFIX };
