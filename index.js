const API_BASE_URL = 'http://127.0.0.1:8444/v1';
const CONCURRENCY = 5; // 设置并发数
const PAUSE_DURATION = 1800 * 1000; // 暂停时间(毫秒)，当前为30分钟
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const fs = require('fs');
const path = require('path');

// 生成随机字符串
const generateRandomString = (length) => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
};

// 获取txt目录下所有txt文件
const getTxtFiles = () => {
    const txtDir = './txt';
    return fs.readdirSync(txtDir)
        .filter(file => file.endsWith('.txt'))
        .map(file => path.join(txtDir, file));
};

// 随机选择并拼接txt内容
const getRandomTxtContent = () => {
    const txtFiles = getTxtFiles();
    if (txtFiles.length === 0) {
        throw new Error('No txt files found in ./txt directory');
    }

    // 如果文件数量大于等于3，随机选择1-3个文件拼接
    if (txtFiles.length >= 3) {
        // 基于概率权重选择文件数量
        const random = Math.random() * 100;  // 0-100的随机数
        let numFilesToCombine;
        if (random < 20) {
            numFilesToCombine = 1;  // 20%概率
        } else if (random < 50) {  // 20-50
            numFilesToCombine = 2;  // 30%概率
        } else {  // 50-100
            numFilesToCombine = 3;  // 50%概率
        }

        function shuffle(array) {
            for (let i = array.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [array[i], array[j]] = [array[j], array[i]];
            }
            return array;
        }

        const shuffledFiles = shuffle([...txtFiles]);
        const selectedFiles = shuffledFiles.slice(0, numFilesToCombine);
        const combinedContent = selectedFiles
            .map(file => fs.readFileSync(file, 'utf8'))
            .join('\n');
        return combinedContent + generateRandomString(30);
    }

    // 如果文件数量小于3，只读取一个文件
    const randomFile = txtFiles[Math.floor(Math.random() * txtFiles.length)];
    const content = fs.readFileSync(randomFile, 'utf8');
    return content + generateRandomString(30);
};

const models = [
    'claude-3-5-sonnet-20240620',
    'claude-3-5-sonnet-20241022',
    'claude-3-haiku-20240307',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
];

function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

shuffle(models);

class RequestProcessor {
    constructor(id) {
        this.id = id;
        this.modelIndex = 0;
        this.n429Count = 0;
        this.n404Count = 0;
        this.error500Count = 0;
        this.switchCount = 0;
        this.pauseUntil = 0;
        this.shouldStop = false;
    }

    async sendRequest() {
        if (this.shouldStop) {
            console.log(`Process ${this.id}: Stopping all requests.`);
            return;
        }

        if (this.pauseUntil > Date.now()) {
            console.log(`Process ${this.id}: Currently paused. Resuming at ${new Date(this.pauseUntil).toLocaleString()}`);
            setTimeout(() => this.sendRequest(), this.pauseUntil - Date.now());
            return;
        }

        try {
            // 每次请求都重新生成消息内容
            const messages = [
                {
                    "role": "system",
                    "content": getRandomTxtContent()
                },
            ];

            const data = {
                "messages": messages,
                "model": models[this.modelIndex],
                "temperature": Math.random(),
                "max_tokens": Math.floor(Math.random() * 10000) + 1000,
                "stream": false,
                "presence_penalty": Math.random(),
                "frequency_penalty": Math.random(),
                "top_p": Math.random(),
                "logit_bias": {}
            };

            const response = await fetch(`${API_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer test',
                    'User-Agent': 'node-fetch/1.0 (+https://github.com/bitinn/node-fetch)',
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip,deflate',
                    'Connection': 'close'
                },
                body: JSON.stringify(data)
            });

            const text = await response.text();
            console.log(`Process ${this.id} Response Text:`, text);
            this.handleResponse(text);

        } catch (error) {
            console.error(`Process ${this.id} Error occurred:`, error.message);
            if (error.message.includes('ECONNREFUSED') || error.message.includes('ENOTFOUND')) {
                console.error(`Process ${this.id}: Address is unavailable. Exiting program.`);
                this.shouldStop = true;
                process.exit(1);
            }
        } finally {
            if (!this.shouldStop) {
                setTimeout(() => this.sendRequest(), 100);
            }
        }
    }

    handleResponse(text) {
        if (text.includes('limit')) {
            this.handleError('n429');
        } else if (text.includes('n404')) {
            this.handleError('n404');
        } else if (text.includes('cookie')) {
            this.error500Count++;
            console.error(`Process ${this.id}: Error detected: 500.`);
            if (this.error500Count >= 3) {
                console.error(`Process ${this.id}: Error 500 occurred 3 times. Exiting program.`);
                this.shouldStop = true;
                process.exit(1);
            }
        } else {
            this.resetErrorCounts();
            const json = JSON.parse(text);
            console.log(`Process ${this.id} Parsed JSON:`, json);
        }

        if (this.switchCount >= models.length) {
            this.pauseUntil = Date.now() + PAUSE_DURATION;
            console.log(`Process ${this.id}: All models have been tried once. Pausing until ${new Date(this.pauseUntil).toLocaleString()}`);
            this.resetSwitchState();
        }
    }

    handleError(errorType) {
        console.error(`Process ${this.id}: Error detected: ${errorType}`);
        if (errorType === 'n429') this.n429Count++;
        if (errorType === 'n404') this.n404Count++;

        if (this.n429Count >= 2 || this.n404Count >= 2) {
            this.modelIndex = (this.modelIndex + 1) % models.length;
            this.switchCount++;
            console.log(`Process ${this.id}: Switching to model: ${models[this.modelIndex]}`);
            this.resetErrorCounts();
        }
    }

    resetErrorCounts() {
        this.n429Count = 0;
        this.n404Count = 0;
        this.error500Count = 0;
    }

    resetSwitchState() {
        this.switchCount = 0;
        this.modelIndex = 0;
    }
}

const startProcessors = async (CONCURRENCY) => {
    for (let i = 1; i <= CONCURRENCY; i++) {
        const processor = new RequestProcessor(i);
        await new Promise(resolve => setTimeout(resolve, 3000)); // 等待3秒
        processor.sendRequest();
        console.log(`Started processor ${i} at ${new Date().toLocaleTimeString()}`);
    }
};

// 调用函数
startProcessors(CONCURRENCY);
