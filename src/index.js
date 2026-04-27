require('dotenv').config();
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { OpenAI } = require('openai');

const Message = require('./models/Message');
const Plan = require('./models/Plan');
const User = require('./models/User');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.AI_BASE_URL || undefined
});

const AI_MODEL = process.env.AI_MODEL || "gpt-4o";

const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

// --- Conexión a MongoDB ---
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('MongoDB Connected'))
    .catch(err => console.log('MongoDB Connection Error:', err));

// --- Rutas ---
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// --- Estructuras de Datos ---
const clients = {}; 
const qrCodes = {};
const focusedChats = {};

// --- Socket.io ---
io.on('connection', (socket) => {
    console.log('New client connected');
    socket.on('disconnect', () => console.log('Client disconnected'));
});

// --- Lógica de IA ---

const triggerOpenAI = async (accountId, chatId, msgBody, tone = 'balanced') => {
    try {
        console.log(`IA analizando mensaje (${tone}) de ${chatId}...`);

        const activePlan = await Plan.findOne({ isActive: true }) || { content: "Foco en cierre de ventas y amabilidad." };
        const user = await User.findOne({ role: 'MASTER_ADMIN' }) || { botName: "Zura", naturalContext: "Profesional y cercano" };
        const recentMessages = await Message.find({ chatId }).sort({ timestamp: -1 }).limit(10);
        const history = recentMessages.reverse().map(m => `${m.from === 'me' ? 'Tú' : 'Cliente'}: ${m.body}`).join('\n');

        let toneInstruction = "Mantén un tono equilibrado y profesional.";
        if (tone === 'friendly') toneInstruction = "Sé extremadamente amable, empático y usa un lenguaje cálido. Usa algunos emojis sutiles.";
        if (tone === 'direct') toneInstruction = "Sé muy directo, conciso y firme. Ve al grano sin rodeos, manteniendo la educación pero con autoridad.";

        const systemPrompt = `
            Eres ${user.botName}, asistente de IA.
            CONTEXTO: ${user.naturalContext}
            ESTRATEGIA: ${activePlan.content}
            TONO ESPECÍFICO: ${toneInstruction}

            HISTORIAL:
            ${history}

            TAREA: Genera la mejor respuesta para Santiago. Solo devuelve el texto de la sugerencia.
        `;

        const completion = await openai.chat.completions.create({
            model: AI_MODEL,
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: msgBody }]
        });

        const suggestion = completion.choices[0].message.content;

        if (tone === 'balanced') {
            await Message.create({ accountId, chatId, from: chatId, body: msgBody, aiSuggestion: suggestion });
        }

        io.emit('new_activity', {
            type: 'ai_suggestion',
            chatId,
            tone,
            message: msgBody,
            suggestion,
            timestamp: new Date()
        });

        return suggestion;
    } catch (err) {
        console.error("Error OpenAI:", err.message);
        return null;
    }
};

// --- Lógica de WhatsApp ---

const initializeWhatsApp = (id) => {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: id }),
        puppeteer: {
            handleSIGINT: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-extensions', '--disable-dev-shm-usage']
        }
    });

    client.on('qr', (qr) => io.emit('qr', { id, qr }));

    client.on('ready', async () => {
        console.log(`Client ${id} ready! Sincronizando...`);
        clients[id] = client;
        io.emit('ready', { id });

        // Sincronización inicial de chats en segundo plano
        try {
            const chats = await client.getChats();
            console.log(`${id}: ${chats.length} chats sincronizados.`);
        } catch (e) {
            console.error("Error sync chats:", e);
        }
    });

    client.on('message', async (msg) => {
        if (msg.from.includes('@g.us')) return;
        await triggerOpenAI(id, msg.from, msg.body);
    });

    client.initialize().catch(err => console.error(`Error init ${id}:`, err));
};

// Endpoints
app.post('/api/whatsapp/init', (req, res) => {
    const { id } = req.body;
    if (clients[id]) return res.json({ status: 'already_connected' });
    initializeWhatsApp(id);
    res.json({ status: 'initializing' });
});

app.get('/api/whatsapp/chats/:id', async (req, res) => {
    const client = clients[req.params.id];
    if (!client) return res.status(404).json({ error: 'Client not connected' });
    try {
        const chats = await client.getChats();
        const simplifiedChats = chats.slice(0, 20).map(c => ({
            id: c.id._serialized,
            name: c.name,
            unreadCount: c.unreadCount,
            timestamp: c.timestamp,
            lastMessage: c.lastMessage ? c.lastMessage.body : ''
        }));
        res.json(simplifiedChats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/whatsapp/messages/:clientId/:chatId', async (req, res) => {
    const client = clients[req.params.clientId];
    if (!client) return res.status(404).json({ error: 'Client not connected' });
    try {
        const chat = await client.getChatById(req.params.chatId);
        const messages = await chat.fetchMessages({ limit: 20 });
        res.json(messages.map(m => ({
            from: m.from,
            body: m.body,
            timestamp: m.timestamp,
            fromMe: m.fromMe,
            hasMedia: m.hasMedia
        })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/ai/variant', async (req, res) => {
    const { accountId, chatId, message, tone } = req.body;
    const suggestion = await triggerOpenAI(accountId, chatId, message, tone);
    res.json({ suggestion });
});

app.get('/health', (req, res) => res.send('Atomic Command Center API is running'));

server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});

