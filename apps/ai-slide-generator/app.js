import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve os arquivos estáticos (HTML/CSS/JS) da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// Inicializa a API do Gemini (A chave virá do docker-compose)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `
Você é um especialista em apresentações minimalistas e comunicação objetiva. 
Seu objetivo é transformar textos brutos em slides usando a sintaxe Markdown do Marp.
Separe os slides estritamente com '---'.

Regras Absolutas:
1. Uma ideia por slide: Cada slide deve conter apenas um argumento ou conceito central.
2. O Teste do Outdoor: O texto visível de cada slide não pode ultrapassar 15 palavras. Se houver mais contexto, coloque-o como notas de apresentador (<!-- nota -->).
3. Proibido marcadores longos: Nunca use listas com mais de 3 itens por tela.
4. Foco Visual: Sugira qual diagrama a pessoa deve desenhar no Excalidraw ao vivo para acompanhar aquele slide (escreva a sugestão em formato de comentário no Markdown).
5. BLUF (Bottom-Line Up Front): O primeiro slide após o título deve obrigatoriamente entregar a conclusão ou a tese principal do assunto.
`;

app.post('/api/generate', async (req, res) => {
    try {
        const { text } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Texto não fornecido.' });
        }

        // Usa o modelo flash que é mais rápido e barato
        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash",
            systemInstruction: SYSTEM_PROMPT
        });

        const result = await model.generateContent(text);
        const markdownSlides = result.response.text();
        
        res.json({ markdown: markdownSlides });
    } catch (error) {
        console.error("Erro ao gerar slides:", error);
        res.status(500).json({ error: 'Erro ao processar a requisição com a IA.' });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`AI Slide Generator rodando na porta ${PORT}`);
});