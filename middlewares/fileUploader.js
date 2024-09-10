
const stream = require('stream');
const { formidable } = require('formidable');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const aws = require('../config/awsBucket');
const {s3} = aws;
const {awsBucketName} = require('../config/configVars');
const lib = require('../lib');

const fileUploadPath  = path.join(__dirname, '../Public/uploads');
const profileUploadPath = path.join(fileUploadPath, './profile');


if(!fs.existsSync(fileUploadPath)) {
    fs.mkdirSync(fileUploadPath);
}

if (!fs.existsSync(profileUploadPath)) {
    fs.mkdirSync(profileUploadPath);
}

const formidableConfig = {
    cloud: {
        fileWriteStreamHandler: (file, uploadPromiseArray) => {
            const body = new stream.PassThrough();
            const upload = s3.upload({
                Bucket: awsBucketName,
                Key: `${file.newFilename}`,
                ContentType: `${file.mimetype}`,
                Body: body
            });
            uploadPromiseArray.push(new Promise((resolve, reject) => {
                upload.send((error, data) => {
                    if (error) {
                        return reject(error);
                    }
                    file.location = data.Location;
                    resolve();
                })
            }))
            return body;
        }
    },
    local: {
        fileWriteStreamHandler: (file, uploadPromiseArray) => {
            const body = new stream.PassThrough();
            const fileWriteStream = fs.createWriteStream(file.filepath); // Ensure the file path is correct
        
            body.pipe(fileWriteStream);
        
            uploadPromiseArray.push(new Promise((resolve, reject) => {
                let isResolved = false;
                fileWriteStream.on('finish', () => {
                    file.location = `${lib.utils.hostUrl()}/uploads/${file.prefixLocation?`${file.prefixLocation}/`:''}${file.newFilename}`
                    if (!isResolved) {
                        isResolved = true;
                        resolve();
                    }
                });
        
                fileWriteStream.on('error', (error) => {
                    if (!isResolved) {
                        isResolved = true;
                        reject(error);
                    }
                });
            }));
            return body;
        }
    }
}

/**
 * 
 * @param {{uploadToCloud: boolean, prefixLocation?: string, extensionAllowed?: Array<RegExp>, maxFiles?: number }} uploadConfig 
 * @returns 
 */
const fileUpload = (uploadConfig) => {
    let { uploadToCloud, prefixLocation = '', extensionAllowed, maxFiles } = uploadConfig;
    const handlerKey = (uploadToCloud)?'cloud':'local'
    let basePath = '';
    if (!uploadToCloud) {
        basePath = `${fileUploadPath}/`;
    }
    return (req, res, next) => {
        const uploadPromiseArray = [];
        const form =  formidable({
            allowEmptyFiles: false,
            maxFileSize: 5 * 1024 * 1024,
            multiples: true,
            filename: (name, ext, part, form) => {
                const extension = path.extname(part.originalFilename);
                return `${name}-${Date.now()}${extension}`
            },
            filter: ((part) => {
                if (!extensionAllowed?.length) {
                    return true;
                }
                for (let extension of extensionAllowed) {
                    if (extension.test(part.mimetype)) {
                        return true;
                    }
                }
                return false;
            }),
            uploadDir: `${basePath}${prefixLocation}`,
            maxFiles: maxFiles ?? 20,
            fileWriteStreamHandler: (file) => {
                file.prefixLocation = prefixLocation;
                const method = formidableConfig[handlerKey].fileWriteStreamHandler;
                return method(file, uploadPromiseArray);
            }
        })
        form.parse(req, (error, fields, files) => {
            if (error) {
                return res.status(500).json({error: error?.message ?? error});
            }
            Promise.all(uploadPromiseArray)
            .then(() => {
                req.body = fields;
                req.files = [];
                Object.values(files).forEach((files) => {
                    files.forEach((file) => {
                        req.files.push(file);
                    })
                })
                next();
            })
            .catch(() => {
                return res.status(500).json({error: 'Something went wrong'});
            });
        });
    }
}

module.exports = {
    fileUpload,
}
