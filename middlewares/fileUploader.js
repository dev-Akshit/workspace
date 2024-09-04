
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const aws = require('../config/awsBucket');
const {s3} = aws;
const {awsBucketName} = require('../config/configVars');

const fileUploadPath  = path.join(__dirname, '../Public/uploads');

if(!fs.existsSync(fileUploadPath)) {
    fs.mkdirSync(fileUploadPath);
}


const fileUpload = (uploadToCloud) => {
    return (req, res, next) =>{
        
        const fileNamePrefix = `${Date.now()}-${crypto.randomBytes(10).toString('hex')}-${req.session.userId}`;

        if(uploadToCloud){
            const uploader = multer({
                storage: multer.memoryStorage(),
                limits: {
                    fileSize: 5 * 1024 * 1024,
                }
            }).any()
            return uploader(req, res, (err) => {
                if (err != null) {
                    console.log(err);
                    return res.status(500).json({error: err?.message ?? err})
                }
                if(req.file){
                    const extension = path.extname(req.file?.originalname);
                    req.file.filename = `${fileNamePrefix}${extension}`;
                    const params = {
                        Bucket: awsBucketName,
                        Body: req.file.buffer,
                        Key: req.file.filename,
                    };
                    s3.upload(params, (err, data) => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({error: err?.message ?? err});
                        }
                    });
                }
        
                if(req.files?.length){
                    req.files.forEach((element) => {
                        const extension = path.extname(element?.originalname);
                        element.filename = `${fileNamePrefix}${extension}`;
                        const params = {
                            Bucket: awsBucketName,
                            Body: element.buffer,
                            Key: element.filename,
                        };
                        s3.upload(params, (err, data) => {
                            if (err) {
                                console.error(err);
                                return res.status(500).json({error: err?.message ?? err});
                            }
                        });
                    })
                }
                next();
                
            });
        }
        else {
            const storage = multer.diskStorage({
                destination: (req, file, cb) => {
                    cb(null, fileUploadPath)
                },
                filename: (req, file , callback) => {
                    const extension = path.extname(file.originalname);
                    const fileName = `${fileNamePrefix}${extension}`;
                    callback(null, fileName);
                }
            })
            const uploader = multer({
                storage: storage,
                limits: {
                    fileSize: 5 * 1024 * 1024,
                }
            }).any()
            return uploader(req, res, (err) => {
                if (err != null) {
                    console.log(err);
                    return res.status(500).json({error: err?.message ?? err})
                }
                next();
            });
        }

        next();
    }
}

module.exports = {
    fileUpload,
}
