const router = require('express').Router();
const config = require('../config/configVars');
const libs = require('../lib');

const middlewares = require('../middlewares');

router.post('/uploadFileMultipart', middlewares.session.checkLogin(true), 
middlewares.fileUploader.fileUpload({ uploadToCloud: config.uploadToCloud}), 
(req, res) => {
    try {
        const urls = [];
        if (req.files?.length) {
            req.files.forEach((element) => {
                if (element.location) {
                    urls.push(element.location )
                }
            })
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

router.post('/uploadProfile', middlewares.session.checkLogin(true), 
middlewares.fileUploader.fileUpload({ 
    uploadToCloud: config.uploadToCloud,
    prefixLocation: 'profile',
    extensionAllowed: [new RegExp('image/*')],
    maxFiles: 1,
}), (req, res) => {
    try {
        let file = req?.files?.[0];
        if (!file) {
            throw new Error('No file uploaded');
        }
        return res.send(file.location);
    } catch (error) {
        console.log(error);
        return res.status(500).json({error: error?.message});
    }
});

module.exports = router;