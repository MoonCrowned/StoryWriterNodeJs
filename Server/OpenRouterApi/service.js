const fs = require('fs');
const path = require('path');
const https = require('https');

const CONFIG_PATH = path.join(__dirname, 'config.txt');
const IMAGES_DIR = path.join(__dirname, 'Images');

// Ensure Images directory exists
if (!fs.existsSync(IMAGES_DIR)){
    try {
        fs.mkdirSync(IMAGES_DIR, { recursive: true });
    } catch (e) {
        console.error("Failed to create Images dir:", e);
    }
}

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
            'HTTP-Referer': 'http://localhost:1234', 
            'X-Title': 'LocalStoryWriter'
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

// Helper: Save Image (Handles both URL download and Base64)
function saveImage(urlOrBase64, filepath) {
    return new Promise((resolve, reject) => {
        // Check if it's a Data URI (Base64)
        if (urlOrBase64.startsWith('data:')) {
            try {
                // Format: data:image/png;base64,iVBORw0KGgo...
                const matches = urlOrBase64.match(/^data:(.+);base64,(.+)$/);
                if (!matches) {
                    return reject("Invalid Base64 data URI format");
                }
                // const type = matches[1]; // e.g., image/png
                const data = matches[2];
                const buffer = Buffer.from(data, 'base64');
                
                fs.writeFile(filepath, buffer, (err) => {
                    if (err) reject(err);
                    else resolve(filepath);
                });
            } catch (err) {
                reject("Failed to save Base64 image: " + err.message);
            }
        } 
        // Handle standard HTTP/HTTPS URL
        else if (urlOrBase64.startsWith('http')) {
            const client = urlOrBase64.startsWith('https') ? https : require('http');
            client.get(urlOrBase64, (res) => {
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
        } else {
            reject("Unknown image source format (not http or data uri)");
        }
    });
}

// 2. Async Image Generation
async function generateImage(model, prompt, aspectRatio) {
    const apiKey = getApiKey();
    if (!apiKey) return { success: false, error: "API Key not found in config.txt" };

    const payload = {
        model: model,
        messages: [
            { role: "user", content: prompt }
        ],
        modalities: ["image", "text"],
        image_config: {
            aspect_ratio: aspectRatio 
        }
    };

    const postData = JSON.stringify(payload);

    const options = {
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
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
        
        let imageUrl = null;
        
        if (result.choices && result.choices.length > 0) {
            const message = result.choices[0].message;
            
            if (message.images && message.images.length > 0) {
                // Check all possible variations
                if (message.images[0].url) imageUrl = message.images[0].url;
                else if (message.images[0].image_url && message.images[0].image_url.url) imageUrl = message.images[0].image_url.url;
                else if (message.images[0].imageUrl && message.images[0].imageUrl.url) imageUrl = message.images[0].imageUrl.url;
            }
            else if (typeof message.content === 'string' && (message.content.startsWith('http') || message.content.startsWith('data:image'))) {
                 imageUrl = message.content;
            }
            else if (result.data && result.data.length > 0 && result.data[0].url) {
                imageUrl = result.data[0].url;
            }
        }

        if (imageUrl) {
            const timestamp = Date.now();
            // Create a safe filename: keep only ASCII letters/digits, drop others
            let cleanPrompt = prompt
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '')
                .substring(0, 20);

            if (!cleanPrompt) {
                cleanPrompt = 'img';
            }

            const filename = `${timestamp}_${cleanPrompt}.png`;
            const filePath = path.join(IMAGES_DIR, filename);
            const metaPath = path.join(IMAGES_DIR, `${filename}.txt`);

            // Use saveImage instead of downloadImage
            await saveImage(imageUrl, filePath);

            // Save Meta
            // Don't save the full Base64 string to meta if it's huge
            const safeUrlLog = imageUrl.startsWith('data:') ? 'Base64 Data (Truncated)' : imageUrl;
            const metaContent = JSON.stringify({ model, prompt, aspectRatio, originalUrl: safeUrlLog }, null, 2);
            fs.writeFileSync(metaPath, metaContent);

            return { success: true, filePath: filePath, url: imageUrl.startsWith('data:') ? '(base64 hidden)' : imageUrl };
        } else {
            console.log("Raw Image Gen Result:", JSON.stringify(result, null, 2));
            return { success: false, error: "No image data found in response", raw: result };
        }
    } catch (err) {
        return { success: false, error: err };
    }
}

module.exports = { generateText, generateImage };
