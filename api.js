const axios = require('axios');
const https = require('https');
const path = require('path');
const fs = require('fs');

const request = axios.create({
    httpsAgent: new https.Agent({  
      rejectUnauthorized: false
    })
  });

const padDatePart = (num) => ('' + num).padStart(2, '0');

module.exports = class Api {

    constructor({host, username, password, downloadPath}) {
        this.host = host;
        this.username = username;
        this.password = password;
        this.downloadPath = downloadPath;
    }

    async processDownload({cameraMac, start, end}) {
        const token = await this.getToken();

        console.log('[api] ' + token);

        const camera = await this.getCameraFromMac({token, cameraMac});

        
        while (start < end) {
            // break up videos longer than 10 minutes
            const calculatedEnd = Math.min(end, start + (10 * 60 * 1000));
            
            this.downloadVideo({token, camera, start, end: calculatedEnd});    

            start += 1 + (10 * 60 * 1000);
        }
    }

    async getToken() {
        const response = await request.post(`${this.host}/api/auth`, {
            'username': this.username,
            'password': this.password
        });
    
        if (!response || !response.headers || !response.headers.authorization) {
            throw new Error('Invalid token api response; received message', response);
        }
    
        return response.headers.authorization;
    }

    /**
     * 
     */
    async getCameraFromMac({token, cameraMac}) {

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
        const requestConfig = {headers};

        const response = await request.get(`${this.host}/api/cameras`, requestConfig);

        const camera = response.data.find(cam => cam.mac === cameraMac);

        if (!camera) {
            throw new Error('Unable to find camera with mac: ' + cameraMac, response);
        }

       return {id: camera.id, name: camera.name};
    }

    async downloadVideo({token, camera, start, end}) {

        const headers = {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
        const date = new Date(start);
        const year = '' + date.getFullYear();
        const month = padDatePart(date.getMonth() + 1);
        const day = padDatePart(date.getDate());
        const hour = padDatePart(date.getHours());
        const minute = padDatePart(date.getMinutes());

        const filePath = path.resolve(this.downloadPath, camera.name, year, month, day);
        console.info(`[api] writing to file path: ${filePath}`);
        
        try {
            await fs.promises.access(filePath);
        } catch (e) {
            // directory doesn't exist, create it
            await fs.promises.mkdir(filePath, {recursive: true});
        }

        const writer = fs.createWriteStream(`${filePath}/${year}-${month}-${day}_${hour}.${minute}_${start}.mp4`);

        const requestConfig = {headers, responseType: 'stream'};

        let response;
        try {
            response = await request.get(`${this.host}/api/video/export?start=${start}&end=${end}&camera=${camera.id}`, requestConfig);    
        } catch (e) {
            console.error('[api] unable to download video', e);
            return;
        }
    
        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve)
            writer.on('error', reject)
        });
    }
}