const axios = require('axios');
const https = require('https');
const path = require('path');
const fs = require('fs');

const request = axios.create({
    httpsAgent: new https.Agent({  
      rejectUnauthorized: false
    })
  });

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

        console.log('[api]');
        console.dir(camera);

        console.log(`[api] download path: ${this.downloadPath}`);
        this.downloadVideo({token, camera, start, end});
    }

    async getToken() {
        // TODO: Header shouldn't be necessary
        const headers = {
            'Content-Type': 'application/json'
        };
        const requestConfig = {headers};
    
        const response = await request.post(`${this.host}/api/auth`, {
            'username': this.username,
            'password': this.password
        }, requestConfig);
    
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

        console.debug('[api] camera response:');
        console.dir(response.data);

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

        const filePath = path.resolve(this.downloadPath, camera.name, '' + date.getFullYear(), '' + (date.getMonth() + 1), '' + date.getDate());
        console.info(`[api] path: ${filePath}`);
        
        const pathExists = await fs.promises.exists(filePath);
        if (!pathExists){
            await fs.promises.mkdir(filePath, {recursive: true});
        }

        const writer = fs.createWriteStream(`${filePath}/${start}.mp4`)

        const requestConfig = {headers, responseType: 'stream'};

        const response = await request.get(`${this.host}/api/video/export?start=${start}&end=${end}&camera=${camera.id}`, requestConfig);

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', resolve)
            writer.on('error', reject)
          });
    }
}