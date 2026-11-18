const fs = require("fs");
const path = require("path");

function logError({ fileName, moduleName, url, errorType, responseTime, errorMessage, errorStack, user, numberOfObject }) {
    const errorLog = {
        date: new Date().toISOString(),
        fileName: fileName || "N/A",
        moduleName: moduleName || "N/A",
        url: url || "N/A",
        ErrorType: errorType || "N/A",
        responseTime: responseTime || "N/A",
        ErrorMessage: errorMessage || "N/A",
        ErrorStack: errorStack || "N/A",  // ✅ Include full stack trace
        // user: user && user.username ? user.username : user.credentials.username ? user.credentials.username : "unknown",
        awbNumber: user ? user.awbNumber : "N/A",
        numberOfObject,
    };
    console.error("🚨 Error Occurred:", JSON.stringify(errorLog, null, 2));
    // Define log file path
    const logDir = path.join(__dirname, "../logs");
    const logFilePath = path.join(logDir, `error_log_${new Date().toISOString().split("T")[0]}.txt`);

    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    fs.appendFileSync(logFilePath, JSON.stringify(errorLog, null, 4) + "\n\n", "utf8");
}


module.exports = { logError }