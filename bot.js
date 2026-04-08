const fs = require('fs');
const path = require('path');
const { initLogs, logMessage, logPing, logSpeed, logWeather, logError } = require('./logger');

initLogs();

const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
envContent.split('\n').forEach(line => {
    if (line.trim()) {
        const [key, ...valueParts] = line.split('=');
        const value = valueParts.join('=');
        if (key && value) {
            process.env[key.trim()] = value.trim();
        }
    }
});

const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const stringSimilarity = require('string-similarity');
const dns = require('dns').promises;
const http = require('http');
const https = require('https');

dns.setDefaultResultOrder('ipv4first');

const token = process.env.TELEGRAM_TOKEN;
const weatherKey = process.env.WEATHER_API_KEY;

const httpAgent = new http.Agent({
    keepAlive: true, 
    keepAliveMsecs: 1000,
    maxSockets: 200,
    maxFreeSockets: 100,
    timeout: 3000
});
const httpsAgent = new https.Agent({ 
    keepAlive: true, 
    keepAliveMsecs: 1000,
    maxSockets: 200,
    maxFreeSockets: 100,
    timeout: 3000
});

const axiosWithRetry = axios.create({
    httpAgent,
    httpsAgent,
    timeout: 3000,
    maxRedirects: 1,
    maxContentLength: 50000,
    decompress: false
});

axiosWithRetry.interceptors.response.use(response => response, error => {
    let config = error.config;
    if (!config) return Promise.reject(error);
    
    config.retryCount = config.retryCount || 0;
    
    if ((error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') && config.retryCount < 1) {
        config.retryCount += 1;
        return new Promise(resolve => setTimeout(() => resolve(axiosWithRetry(config)), 100));
    }
    
    return Promise.reject(error);
});

const bot = new TelegramBot(token, { 
    polling: {
        interval: 1000,
        autoStart: true,
        params: { timeout: 30, limit: 100 }
    }
});

const georgianCities = [
    'Tbilisi', 'Batumi', 'Kutaisi', 'Rustavi', 'Gori', 'Zugdidi', 'Poti', 
    'Khashuri', 'Samtredia', 'Senaki', 'Zestafoni', 'Marneuli', 'Telavi', 
    'Akhaltsikhe', 'Kobuleti', 'Ozurgeti', 'Kaspi', 'Chiatura', 'Tsqaltubo', 'Sagarejo'
];

const coordinatesCache = {
    tbilisi: { name: 'Tbilisi', lat: 41.7151, lon: 44.8271 },
    batumi: { name: 'Batumi', lat: 41.6258, lon: 41.6328 },
    kutaisi: { name: 'Kutaisi', lat: 42.2949, lon: 43.2306 },
    rustavi: { name: 'Rustavi', lat: 41.5528, lon: 45.5238 },
    gori: { name: 'Gori', lat: 41.9885, lon: 44.1134 },
    zugdidi: { name: 'Zugdidi', lat: 42.5050, lon: 41.8628 },
    poti: { name: 'Poti', lat: 42.6774, lon: 41.6534 },
    khashuri: { name: 'Khashuri', lat: 42.3797, lon: 43.6319 },
    samtredia: { name: 'Samtredia', lat: 42.3450, lon: 43.2017 },
    senaki: { name: 'Senaki', lat: 42.4633, lon: 41.9922 },
    zestafoni: { name: 'Zestafoni', lat: 42.3672, lon: 43.0833 },
    marneuli: { name: 'Marneuli', lat: 41.3856, lon: 44.9975 },
    telavi: { name: 'Telavi', lat: 41.9222, lon: 45.9675 },
    akhaltsikhe: { name: 'Akhaltsikhe', lat: 41.6428, lon: 42.9856 },
    kobuleti: { name: 'Kobuleti', lat: 41.7406, lon: 41.8072 },
    ozurgeti: { name: 'Ozurgeti', lat: 41.8872, lon: 41.9194 },
    kaspi: { name: 'Kaspi', lat: 41.9453, lon: 44.2703 },
    chiatura: { name: 'Chiatura', lat: 42.2950, lon: 43.2744 },
    tsqaltubo: { name: 'Tsqaltubo', lat: 42.4261, lon: 41.8583 },
    sagarejo: { name: 'Sagarejo', lat: 41.8597, lon: 45.9319 }
};

const cityLookup = new Map(georgianCities.map(c => [c.toLowerCase(), c]));

const inFlightRequests = new Map();

async function warmupConnectionPool() {
    logMessage('Warming up connection pool...');
    try {
        await axiosWithRetry.get(`http://api.openweathermap.org/geo/1.0/direct?q=Tbilisi,GE&limit=1&appid=${weatherKey}`);
        
        await axiosWithRetry.get(`https://api.openweathermap.org/data/2.5/weather?lat=41.7151&lon=44.8271&appid=${weatherKey}&units=metric`);
        
        logMessage('Connection pool warmed up ✓');
    } catch (e) {
        logError('WARMUP', e.message);
    }
}

bot.onText(/\/speed/, async (msg) => {
    const chatId = msg.chat.id;
    const startTime = Date.now();
    
    try {
        await bot.getMe();
        const responseTime = Date.now() - startTime;
        logSpeed(responseTime);
        bot.sendMessage(chatId, `⚡ Speed: ${responseTime}ms`).catch(() => {});
    } catch (err) {
        logError('SPEED', err.message);
    }
});

async function sendWeather(chatId, city) {
    const startTime = Date.now();
    try {
        const cacheKey = city.toLowerCase();
        
        if (inFlightRequests.has(cacheKey)) {
            try {
                const result = await inFlightRequests.get(cacheKey);
                const responseTime = Date.now() - startTime;
                logWeather(result.name, responseTime);
                
                const message = `Weather in *${result.name}*, Georgia:\n🌡 ${result.temp}°C • 🤔 ${result.feelsLike}°C • ${result.description}`;
                bot.sendMessage(chatId, message, { parse_mode: 'Markdown' }).catch(() => {});
                return;
            } catch (err) {
                logError('DEDUP', err.message);
            }
        }

        const requestPromise = (async () => {
            const cacheCoords = coordinatesCache[cacheKey];
            
            if (cacheCoords) {
                    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${cacheCoords.lat}&lon=${cacheCoords.lon}&appid=${weatherKey}&units=metric`;
                const response = await axiosWithRetry.get(weatherUrl);

                return {
                    name: cacheCoords.name,
                    temp: Math.round(response.data.main.temp),
                    feelsLike: Math.round(response.data.main.feels_like),
                    description: response.data.weather[0].description.charAt(0).toUpperCase() + response.data.weather[0].description.slice(1)
                };
            }
            
            const geoUrl = `http://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)},GE&limit=1&appid=${weatherKey}`;
            const geoRes = await axiosWithRetry.get(geoUrl);
            
            if (!geoRes.data || geoRes.data.length === 0) {
                throw new Error('City not found');
            }

            const { lat, lon, name } = geoRes.data[0];
            const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${weatherKey}&units=metric`;
            
            const response = await axiosWithRetry.get(weatherUrl);

            return {
                name,
                temp: Math.round(response.data.main.temp),
                feelsLike: Math.round(response.data.main.feels_like),
                description: response.data.weather[0].description.charAt(0).toUpperCase() + response.data.weather[0].description.slice(1)
            };
        })();

        inFlightRequests.set(cacheKey, requestPromise);

        try {
            const weatherData = await requestPromise;

            const responseTime = Date.now() - startTime;
            logWeather(weatherData.name, responseTime);

            const message = `Weather in *${weatherData.name}*, Georgia:\n🌡 ${weatherData.temp}°C • 🤔 ${weatherData.feelsLike}°C • ${weatherData.description}`;
            
            bot.sendMessage(chatId, message, { parse_mode: 'Markdown' }).catch(() => {});
        } finally {
            inFlightRequests.delete(cacheKey);
        }
    } catch (error) {
        if (error.message === 'City not found') {
            handleCityError(chatId, city);
        } else {
            logError('WEATHER', error.message);
            bot.sendMessage(chatId, "⚠️ Service error").catch(() => {});
        }
    }
}

function handleCityError(chatId, input) {
    const matches = stringSimilarity.findBestMatch(input, georgianCities);
    const suggestions = matches.ratings
        .filter(match => match.rating >= 0.75)
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 3);

    if (suggestions.length > 0) {
        const suggestionButtons = suggestions.map(s => [s.target]);
        bot.sendMessage(chatId, `City not found. Did you mean:`, {
            reply_markup: {
                keyboard: suggestionButtons,
                one_time_keyboard: true,
                resize_keyboard: true
            }
        }).catch(() => {});
    } else {
        bot.sendMessage(chatId, "❌ I couldn't find this city in Georgia. Please check the spelling (use Latin letters for better results).").catch(() => {});
    }
}

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 
        `Hello ${msg.from.first_name}! 🇬🇪\nType any city in Georgia to get the current weather:`,
        {
            reply_markup: {
                keyboard: [['Tbilisi', 'Batumi', 'Kutaisi']],
                resize_keyboard: true
            }
        }
    ).catch(() => {});
});

bot.on('message', (msg) => {
    const text = msg.text?.trim();
    if (!text || text.startsWith('/')) return;
    
    if (text.length > 50 || /[\d+*-]/.test(text)) return;
    
    setImmediate(() => sendWeather(msg.chat.id, text));
});

bot.on('error', (err) => {
    if (err.message.includes('409')) return; 
    logError('BOT', err.message);
});

bot.on('polling_error', (err) => {
    if (err.message.includes('ECONNRESET')) return; 
    logError('POLLING', err.message);
});

if (global.gc) setInterval(() => global.gc(), 60000);

setImmediate(() => warmupConnectionPool());

logMessage('Bot started - Ready for requests');