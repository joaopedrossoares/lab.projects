const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Pasta onde todas as cifras e listas serão salvas localmente
const BASE_DIR = path.join(__dirname, 'cifras_local');

if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Endpoint para listar TODAS as cifras (com suporte offline)
app.get('/api/artist/:name', async (req, res) => {
    const artist = req.params.name.toLowerCase().trim();
    const artistDir = path.join(BASE_DIR, artist);
    const listPath = path.join(artistDir, 'lista_musicas.json');

    // 1. VERIFICAÇÃO OFFLINE
    if (fs.existsSync(listPath)) {
        console.log(`[OFFLINE] Carregando catálogo completo local de: ${artist}`);
        const localData = fs.readFileSync(listPath, 'utf-8');
        return res.json(JSON.parse(localData));
    }

    // 2. FLUXO ONLINE: Busca na lista alfabética completa
    try {
        console.log(`[ONLINE] Buscando catálogo completo na web para: ${artist}`);
        
        // Atualizado: aponta para a página com todas as músicas em ordem alfabética
        const targetUrl = `https://www.cifraclub.com.br/${artist}/musicas.html?order=alphabetical`;
        const response = await axios.get(targetUrl);
        const $ = cheerio.load(response.data);
        const songs = [];

        // Termos que aparecem na URL (nível 2) mas não são músicas
        const ignoredSlugs = ['musicas.html', 'discografia', 'fotos', 'biografia', 'eventos', 'relacionados'];

        $('a').each((i, el) => {
            const href = $(el).attr('href');
            
            if (href && href.startsWith(`/${artist}/`) && href !== `/${artist}/`) {
                // Quebra a URL para pegar apenas os slugs
                const parts = href.split('/').filter(Boolean);
                
                // Valida se é um link de cifra (artista/musica) e não possui âncoras ou query strings
                if (parts.length === 2 && !href.includes('#') && !href.includes('?')) {
                    const slug = parts[1];
                    
                    // Verifica se o slug não é uma página do sistema do Cifra Club
                    if (!ignoredSlugs.includes(slug)) {
                        let title = $(el).text().trim() || slug;
                        title = title.replace(/\n/g, '').replace(/\s{2,}/g, ' ');

                        // Evita duplicatas na lista final
                        if (title && !songs.find(s => s.slug === slug)) {
                            songs.push({ 
                                title, 
                                slug: slug,
                                url: `https://www.cifraclub.com.br${href}` 
                            });
                        }
                    }
                }
            }
        });

        // Ordena a lista de músicas em ordem alfabética antes de salvar
        songs.sort((a, b) => a.title.localeCompare(b.title));

        if (!fs.existsSync(artistDir)) {
            fs.mkdirSync(artistDir, { recursive: true });
        }
        fs.writeFileSync(listPath, JSON.stringify(songs, null, 2), 'utf-8');

        res.json(songs);
    } catch (error) {
        console.error('Erro:', error.message);
        res.status(500).json({ error: 'Você está offline ou a página alfabética não existe para este artista.' });
    }
});

// Endpoint para renderizar a cifra (mantido igual)
app.get('/api/cifra', async (req, res) => {
    const { artist, slug, url } = req.query;
    if (!artist || !slug) return res.status(400).send('Parâmetros incompletos.');

    const artistDir = path.join(BASE_DIR, artist.toLowerCase());
    const filePath = path.join(artistDir, `${slug}.html`);

    // 1. VERIFICAÇÃO OFFLINE
    if (fs.existsSync(filePath)) {
        console.log(`[OFFLINE] Servindo HTML: ${slug}.html`);
        const htmlLocal = fs.readFileSync(filePath, 'utf-8');
        return res.send(htmlLocal);
    }

    // 2. FLUXO ONLINE
    try {
        console.log(`[ONLINE] Baixando: ${slug}.html`);
        const response = await axios.get(url);
        let html = response.data;

        html = html.replace('<head>', '<head><base href="https://www.cifraclub.com.br">');

        if (!fs.existsSync(artistDir)) {
            fs.mkdirSync(artistDir, { recursive: true });
        }

        fs.writeFileSync(filePath, html, 'utf-8');

        res.send(html);
    } catch (error) {
        console.error('Erro ao salvar cifra:', error.message);
        res.status(500).send('Erro ao obter a cifra. Sem conexão e sem cópia local.');
    }
});

app.listen(PORT, () => console.log(`Servidor atualizado rodando em http://localhost:${PORT}`));