const fs = require('fs');
const path = require('path');
const https = require('https');

const CONFIG_PATH = path.join(__dirname, 'config.txt');
const IMAGES_DIR = path.join(__dirname, 'Images');

// Helper to load config
function getApiKey() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const content = fs.readFileSync(CONFIG_PATH, 'utf8');
            const match = content.match(/OPENROUTER_API_KEY=(.+)/);
            return match ? match[1].trim() : null;
        }
    } catch (err) {
        console.error("Error reading config:", err);
    }
    return null;
}

// Helper to make HTTPS request
function makeRequest(options, postData) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            
            // If image generation returns binary, we might need different handling, 
            // but typically APIs return JSON with a URL or B64.
            res.setEncoding('utf8'); 

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(json);
                    } else {
                        reject({ status: res.statusCode, error: json });
                    }
                } catch (e) {
                    reject({ status: res.statusCode, error: data, message: "Failed to parse response" });
                }
            });
        });

        req.on('error', (e) => {
            reject({ status: 500, error: e.message });
        });

        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

// 1. Async Text Generation
async function generateText(model, prompt) {
    const apiKey = getApiKey();
    if (!apiKey) return { success: false, error: "API Key not found in config.txt" };

    const postData = JSON.stringify({
        model: model,
        messages: [
            { role: "user", content: prompt }
        ]
    });

    const options = {
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:1234', // OpenRouter requires this
            'X-Title': 'LocalStoryWriter' // OpenRouter requires this
        }
    };

    try {
        const result = await makeRequest(options, postData);
        if (result.choices && result.choices.length > 0) {
            return { 
                success: true, 
                text: result.choices[0].message.content 
            };
        } else {
            return { success: false, error: "No content generated", raw: result };
        }
    } catch (err) {
        return { success: false, error: err };
    }
}

// Helper: Download image from URL
function downloadImage(url, filepath) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : require('http');
        client.get(url, (res) => {
            if (res.statusCode === 200) {
                const file = fs.createWriteStream(filepath);
                res.pipe(file);
                file.on('finish', () => {
                    file.close(() => resolve(filepath));
                });
            } else {
                reject(`Failed to download image: Status ${res.statusCode}`);
            }
        }).on('error', (err) => {
            fs.unlink(filepath, () => {}); // Delete failed file
            reject(err.message);
        });
    });
}

// 2. Async Image Generation
async function generateImage(model, prompt, aspectRatio) {
    const apiKey = getApiKey();
    if (!apiKey) return { success: false, error: "API Key not found in config.txt" };

    // Map aspect ratios to dimensions (OpenRouter/OpenAI standard usually prefers explicit sizes)
    // Note: DALL-E 3 supports specific sizes. Other models might vary.
    // We will send width/height based on aspect ratio for broad compatibility.
    let width = 1024;
    let height = 1024;

    switch (aspectRatio) {
        case "16:9": width = 1024; height = 576; break; // actually 1792x1024 for D3 but keeping generic
        case "4:3": width = 1024; height = 768; break;
        case "1:1": width = 1024; height = 1024; break;
        case "3:4": width = 768; height = 1024; break;
        case "9:16": width = 576; height = 1024; break;
    }

    const postData = JSON.stringify({
        model: model,
        prompt: prompt,
        size: `${width}x${height}` 
        // Note: Some OpenRouter image models might expect different params. 
        // We follow the standard OpenAI image generation body.
    });

    const options = {
        hostname: 'openrouter.ai',
        path: '/api/v1/images/generations',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'http://localhost:1234',
            'X-Title': 'LocalStoryWriter'
        }
    };

    try {
        const result = await makeRequest(options, postData);
        
        // Handle response
        if (result.data && result.data.length > 0 && result.data[0].url) {
            const imageUrl = result.data[0].url;
            const timestamp = Date.now();
            const cleanPrompt = prompt.replace(/[^a-z0-9]/gi, '_').substring(0, 20);
            const filename = `${timestamp}_${cleanPrompt}.png`; // Assuming PNG
            const filePath = path.join(IMAGES_DIR, filename);
            const metaPath = path.join(IMAGES_DIR, `${filename}.txt`);

            // Save Image
            await downloadImage(imageUrl, filePath);

            // Save Meta
            const metaContent = JSON.stringify({ model, prompt, aspectRatio }, null, 2);
            fs.writeFileSync(metaPath, metaContent);

            return { success: true, filePath: filePath, url: imageUrl };
        } else {
            return { success: false, error: "No image data returned", raw: result };
        }
    } catch (err) {
        return { success: false, error: err };
    }
}

module.exports = { generateText, generateImage };
