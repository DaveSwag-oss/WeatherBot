require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

const token = process.env.TELEGRAM_TOKEN;
const weatherKey = process.env.WEATHER_API_KEY;

const bot = new TelegramBot(token, { polling: true });

async function sendWeather(chatId, city) {
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${weatherKey}&units=metric`;
        const response = await axios.get(url);

        const temp = Math.round(response.data.main.temp);
        const feelsLike = Math.round(response.data.main.feels_like);
        const condition = response.data.weather[0].main; 
        const description = response.data.weather[0].description;

        const message = `Weather in *${city}*:\n\n` +
                        `🌡 Temperature: ${temp}°C\n` +
                        `🤔 Feels like: ${feelsLike}°C\n` +
                        `☁️ Condition: ${description}`;

        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    } catch (error) {
        bot.sendMessage(chatId, "❌ Sorry, I couldn't find the weather for that city. Please try again later.");
        console.error("API Error:", error.response ? error.response.data : error.message);
    }
}

const options = {
    reply_markup: {
        keyboard: [
            ['Kutaisi', 'Tbilisi'],
            ['Batumi']
        ],
        resize_keyboard: true
    }
};

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 
        `Hello ${msg.from.first_name}! 👋\nI'm your Weather Bot. Choose a city to see the current conditions:`, 
        options
    );
});

bot.on('message', (msg) => {
    const text = msg.text;
    const chatId = msg.chat.id;

    const cities = ['Kutaisi', 'Tbilisi', 'Batumi'];

    if (cities.includes(text)) {
        sendWeather(chatId, text);
    } else if (text !== '/start') {
        bot.sendMessage(chatId, "Please use the menu buttons to select a city!");
    }
});

bot.on('message', (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        sendWeather(msg.chat.id, msg.text);
    }
});

console.log("Weather bot is running...");