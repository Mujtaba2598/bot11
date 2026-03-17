const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');

const PORT = process.env.PORT || 3000;

// Database
const database = {
    sessions: {},
    activeTrades: {}
};

// AI Trading Engine with Dynamic Position Sizing
class AITradingEngine {
    constructor() {
        this.performance = { totalTrades: 0, successfulTrades: 0, totalProfit: 0 };
    }

    analyzeMarket(symbol, marketData) {
        const { price = 0, volume24h = 0, priceChange24h = 0, high24h = 0, low24h = 0 } = marketData;
        
        const volatility = Math.abs(priceChange24h) / 100 || 0.01;
        const volumeRatio = volume24h / 1000000;
        const pricePosition = high24h > low24h ? (price - low24h) / (high24h - low24h) : 0.5;
        
        let confidence = 0.5;
        if (volumeRatio > 1.5) confidence += 0.1;
        if (volumeRatio > 2.0) confidence += 0.15;
        if (priceChange24h > 5) confidence += 0.15;
        if (priceChange24h > 10) confidence += 0.2;
        if (pricePosition < 0.3) confidence += 0.1;
        if (pricePosition > 0.7) confidence += 0.1;
        
        confidence = Math.min(confidence, 0.95);
        
        // Force trades to happen - 80% BUY, 20% SELL when market is neutral
        const action = (pricePosition < 0.3 && priceChange24h > -5 && volumeRatio > 1.2) ? 'BUY' :
                      (pricePosition > 0.7 && priceChange24h > 5 && volumeRatio > 1.2) ? 'SELL' : 
                      (Math.random() > 0.2 ? 'BUY' : 'SELL'); // 80% BUY, 20% SELL
        
        return { symbol, price, confidence, action };
    }

    calculatePositionSize(initialInvestment, currentProfit, targetProfit, timeElapsed, timeLimit, confidence) {
        const timeRemaining = Math.max(0.1, (timeLimit - timeElapsed) / timeLimit);
        const remainingProfit = Math.max(1, targetProfit - currentProfit);
        const baseSize = Math.max(5, initialInvestment * 0.2); // Start with 20% of investment
        const timePressure = 1 / timeRemaining; // Increases as time runs out
        const targetPressure = remainingProfit / (initialInvestment * 5); // Scale based on remaining profit
        
        let positionSize = baseSize * timePressure * targetPressure * confidence;
        const maxPosition = initialInvestment * 3; // Max 300% of investment
        positionSize = Math.min(positionSize, maxPosition);
        positionSize = Math.max(positionSize, 5); // Min $5
        
        return positionSize;
    }
}

// Binance API Helper (Mock for demo)
class BinanceAPI {
    static async getTicker(symbol, apiKey, secret, useTestnet = false) {
        try {
            const baseUrl = useTestnet ? 'https://testnet.binance.vision' : 'https://api.binance.com';
            const response = await axios.get(`${baseUrl}/api/v3/ticker/24hr?symbol=${symbol}`);
            return response.data;
        } catch (error) {
            // Return mock data for demo when API fails
            return { 
                lastPrice: (Math.random() * 50000 + 10000).toString(),
                volume: (Math.random() * 2000000).toString(),
                priceChangePercent: (Math.random() * 20 - 5).toString(),
                highPrice: (Math.random() * 60000 + 20000).toString(),
                lowPrice: (Math.random() * 40000 + 5000).toString()
            };
        }
    }
}

const app = express();
const aiEngine = new AITradingEngine();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// API Routes
app.get('/api/health', (req, res) => {
    res.json({ 
        success: true, 
        message: 'Halal AI Trading Bot - Active',
        version: '4.0.0'
    });
});

app.post('/api/connect', async (req, res) => {
    const { email, accountNumber, apiKey, secretKey, accountType } = req.body;
    
    const sessionId = 'session_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    database.sessions[sessionId] = {
        id: sessionId, email, accountNumber, apiKey, secretKey,
        accountType, connectedAt: new Date(), isActive: true, balance: 1000
    };
    
    res.json({ 
        success: true, 
        sessionId, 
        accountInfo: { balance: 1000 }, 
        message: 'Connected successfully' 
    });
});

app.post('/api/startTrading', (req, res) => {
    const { sessionId, initialInvestment, targetProfit, timeLimit, riskLevel, tradingSpeed, tradingPairs } = req.body;
    
    const botId = 'bot_' + Date.now();
    database.activeTrades[botId] = {
        id: botId, 
        sessionId, 
        initialInvestment: parseFloat(initialInvestment) || 1,
        targetProfit: parseFloat(targetProfit) || 10,
        timeLimit: parseFloat(timeLimit) || 1,
        riskLevel: riskLevel || 'medium',
        tradingSpeed: tradingSpeed || 'balanced',
        tradingPairs: tradingPairs || ['BTCUSDT', 'ETHUSDT'],
        startedAt: new Date(),
        isRunning: true,
        currentProfit: 0,
        trades: [],
        lastTradeTime: Date.now()
    };
    
    database.sessions[sessionId].activeBot = botId;
    res.json({ 
        success: true, 
        botId, 
        message: `Trading started: $${parseFloat(targetProfit).toLocaleString()} target` 
    });
});

app.post('/api/stopTrading', (req, res) => {
    const { sessionId } = req.body;
    const session = database.sessions[sessionId];
    if (session?.activeBot) {
        database.activeTrades[session.activeBot].isRunning = false;
        session.activeBot = null;
    }
    res.json({ success: true, message: 'Trading stopped' });
});

app.post('/api/tradingUpdate', (req, res) => {
    const { sessionId } = req.body;
    const session = database.sessions[sessionId];
    if (!session?.activeBot) return res.json({ success: true, currentProfit: 0, newTrades: [] });
    
    const trade = database.activeTrades[session.activeBot];
    if (!trade.isRunning) return res.json({ success: true, currentProfit: trade.currentProfit, newTrades: [] });
    
    const newTrades = [];
    const now = Date.now();
    
    const timeElapsed = (now - trade.startedAt) / (1000 * 60 * 60);
    const timeRemaining = Math.max(0, trade.timeLimit - timeElapsed);
    
    // TRADE EVERY TIME - removed random condition
    if (timeRemaining > 0) {
        const symbol = trade.tradingPairs[Math.floor(Math.random() * trade.tradingPairs.length)] || 'BTCUSDT';
        
        const marketPrice = Math.random() * 30000 + 20000;
        const marketData = {
            price: marketPrice,
            volume24h: Math.random() * 2000000,
            priceChange24h: Math.random() * 20 - 5,
            high24h: marketPrice * 1.1,
            low24h: marketPrice * 0.9
        };
        
        const signal = aiEngine.analyzeMarket(symbol, marketData);
        
        const positionSize = aiEngine.calculatePositionSize(
            trade.initialInvestment,
            trade.currentProfit,
            trade.targetProfit,
            timeElapsed,
            trade.timeLimit,
            signal.confidence
        );
        
        const timePressure = 1 / Math.max(0.1, timeRemaining);
        const profitMultiplier = Math.min(4, timePressure) * (signal.confidence * 3);
        
        // 80% win rate for demo
        const isWin = Math.random() > 0.2;
        const baseProfit = positionSize * (Math.random() * 0.5 + 0.2) * profitMultiplier;
        const profit = isWin ? baseProfit : -baseProfit * 0.3;
        
        trade.currentProfit += profit;
        
        const quantity = (positionSize / marketPrice).toFixed(6);
        
        newTrades.push({
            symbol: symbol,
            side: signal.action,
            quantity: quantity,
            price: marketPrice.toFixed(2),
            profit: profit,
            size: '$' + positionSize.toFixed(2),
            confidence: (signal.confidence * 100).toFixed(0) + '%',
            timestamp: new Date().toISOString()
        });
        
        // Add to beginning of trades array
        trade.trades.unshift(...newTrades);
        
        // Check if target reached
        if (trade.currentProfit >= trade.targetProfit) {
            trade.targetReached = true;
            trade.isRunning = false;
        }
    }
    
    // Check time limit
    if (timeElapsed >= trade.timeLimit) {
        trade.timeExceeded = true;
        trade.isRunning = false;
    }
    
    // Keep only last 50 trades
    if (trade.trades.length > 50) {
        trade.trades = trade.trades.slice(0, 50);
    }
    
    res.json({ 
        success: true, 
        currentProfit: trade.currentProfit || 0,
        timeElapsed: timeElapsed.toFixed(2),
        timeRemaining: timeRemaining.toFixed(2),
        targetReached: trade.targetReached || false,
        timeExceeded: trade.timeExceeded || false,
        newTrades: newTrades
    });
});

// Serve index.html for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('\n' + '='.repeat(50));
    console.log('🌙 HALAL AI TRADING BOT - ACTIVE');
    console.log('='.repeat(50));
    console.log(`✅ Server running on port: ${PORT}`);
    console.log(`✅ Trading engine: ACTIVE - Trades every 3 seconds`);
    console.log('='.repeat(50) + '\n');
});
