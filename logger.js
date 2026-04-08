const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, 'TestOnThePing.txt');

let logBuffer = [];
let isWriting = false;

function initLogs() {
    fs.writeFileSync(logFile, '', 'utf8');
    logMessage('=== BOT STARTED ===');
}

function logMessage(message) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}\n`;
    
    process.stdout.write(entry);
    
    logBuffer.push(entry);
    
    if (logBuffer.length >= 10) {
        flushLogs();
    }
}

function flushLogs() {
    if (isWriting || logBuffer.length === 0) return;
    
    isWriting = true;
    const toWrite = logBuffer.join('');
    logBuffer = [];
    
    fs.appendFile(logFile, toWrite, 'utf8', () => {
        isWriting = false;
        if (logBuffer.length > 0) flushLogs();
    });
}

process.on('SIGINT', () => {
    if (logBuffer.length > 0) {
        fs.appendFileSync(logFile, logBuffer.join(''), 'utf8');
    }
    process.exit(0);
});

function logPing(responseTime, userName) {
    logMessage(`PING - ${responseTime}ms | ${userName}`);
}

function logSpeed(responseTime) {
    logMessage(`SPEED - ${responseTime}ms`);
}

function logWeather(city, responseTime, cacheLabel = '') {
    logMessage(`WEATHER - ${city} | ${responseTime}ms ${cacheLabel}`);
}

function logError(command, error) {
    const errorMsg = error.substring(0, 80);
    logMessage(`ERROR [${command}] - ${errorMsg}`);
}

module.exports = {
    initLogs,
    logMessage,
    logPing,
    logSpeed,
    logWeather,
    logError
};
