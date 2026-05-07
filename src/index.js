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

const clientStatus = {};

// --- Socket.io ---
io.on('connection', (socket) => {
    console.log('New client connected');
    // Replay any existing QR codes to newly connected clients
    Object.keys(qrCodes).forEach(id => {
        if (qrCodes[id]) socket.emit('qr', { id, qr: qrCodes[id] });
    });
    Object.keys(clientStatus).forEach(id => {
        if (clientStatus[id] === 'connected') socket.emit('ready', { id });
    });
    socket.on('disconnect', () => console.log('Client disconnected'));
});;

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
    console.log(`[INIT] Inicializando cliente WhatsApp para: ${id}`);
    clientStatus[id] = 'initializing';
    delete qrCodes[id];

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: id }),
        puppeteer: {
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            handleSIGINT: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920,1080'
            ]
        }
    });

    client.on('qr', (qr) => {
        console.log(`[QR] QR generado para ${id}`);
        qrCodes[id] = qr;
        clientStatus[id] = 'qr';
        io.emit('qr', { id, qr });
    });

    client.on('loading_screen', (percent, message) => {
        console.log(`[LOAD] ${id}: ${percent}% - ${message}`);
    });

    client.on('authenticated', () => {
        console.log(`[AUTH] ${id} autenticado!`);
        clientStatus[id] = 'authenticated';
        delete qrCodes[id];
    });

    client.on('auth_failure', (msg) => {
        console.error(`[AUTH_FAIL] ${id}:`, msg);
        clientStatus[id] = 'disconnected';
        delete qrCodes[id];
    });

    client.on('ready', async () => {
        console.log(`[READY] Client ${id} listo!`);
        clients[id] = client;
        clientStatus[id] = 'connected';
        delete qrCodes[id];
        io.emit('ready', { id });

        try {
            const chats = await client.getChats();
            console.log(`[SYNC] ${id}: ${chats.length} chats sincronizados.`);
        } catch (e) {
            console.error("Error sync chats:", e);
        }
    });

    client.on('disconnected', (reason) => {
        console.log(`[DISCONNECTED] ${id}: ${reason}`);
        clientStatus[id] = 'disconnected';
        delete clients[id];
        delete qrCodes[id];
        io.emit('disconnected', { id, reason });
    });

    client.on('message', async (msg) => {
        if (msg.from.includes('@g.us')) return;
        await triggerOpenAI(id, msg.from, msg.body);
    });

    client.initialize().catch(err => {
        console.error(`[ERROR] init ${id}:`, err);
        clientStatus[id] = 'error';
    });
};

// Endpoints
app.post('/api/whatsapp/init', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    if (clients[id]) return res.json({ status: 'already_connected' });
    if (clientStatus[id] === 'initializing' || clientStatus[id] === 'qr') {
        return res.json({ status: clientStatus[id], qr: qrCodes[id] || null });
    }
    initializeWhatsApp(id);
    res.json({ status: 'initializing' });
});

// Endpoint REST para obtener QR sin socket (polling fallback)
app.get('/api/whatsapp/qr/:id', (req, res) => {
    const { id } = req.params;
    const status = clientStatus[id] || 'disconnected';
    const qr = qrCodes[id] || null;
    res.json({ status, qr });
});

// Endpoint para ver el QR como imagen directa (PNG)
const QRCode = require('qrcode');
app.get('/api/whatsapp/qr/:id/image', async (req, res) => {
    const { id } = req.params;
    const qr = qrCodes[id];
    if (!qr) return res.status(404).send('QR not generated yet. Please wait or init node.');
    
    try {
        const img = await QRCode.toBuffer(qr);
        res.type('png');
        res.send(img);
    } catch (err) {
        res.status(500).send('Error generating QR image');
    }
});

// Endpoint de estado
app.get('/api/whatsapp/status/:id', (req, res) => {
    const { id } = req.params;
    res.json({ 
        status: clientStatus[id] || 'disconnected',
        hasQR: !!qrCodes[id],
        isConnected: !!clients[id]
    });
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

app.post('/api/whatsapp/reset', async (req, res) => {
    const { id } = req.body;
    if (clients[id]) {
        try {
            await clients[id].destroy();
            delete clients[id];
            console.log(`Client ${id} destroyed for reset.`);
        } catch (e) {
            console.error(`Error destroying client ${id}:`, e);
        }
    }
    initializeWhatsApp(id);
    res.json({ status: 'resetting' });
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

