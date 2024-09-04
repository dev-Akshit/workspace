const router = require('express').Router();
const libs = require('../lib');

const middlewares = require('../middlewares');

const uploadToCloud = process.env.UPLOAD_TO_CLOUD === "true";

router.post('/uploadFileMultipart', middlewares.session.checkLogin(true), 
middlewares.fileUploader.fileUpload(uploadToCloud), 
(req, res) => {
    try {
        const baseUrl = uploadToCloud ? `${libs.utils.cloudStorageUrl()}` : `${libs.utils.hostUrl()}/uploads`;
        const urls = [];
        if (req.files?.length) {
            req.files.forEach((element) => {
                urls.push(`${baseUrl}/${element.filename}`);
            })
        }
        if (req.file) {
            const fileUrl = urls.push(`${baseUrl}/${req.file.filename}`);
            urls.push(fileUrl);
        }
        if (urls.length < 2) {
            return res.json({url: urls?.[0]});
        }
        return res.json({urls: urls});
    } catch (error) {
        console.log(error);
        return res.status(500).json({error: error?.message});
    }
})

module.exports = router;