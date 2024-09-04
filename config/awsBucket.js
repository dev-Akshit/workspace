const AWS = require('aws-sdk');
const {awsPassword, awsToken, awsRegion} = require('./configVars');

AWS.config.update({
  accessKeyId: awsToken,
  secretAccessKey: awsPassword,
  region: awsRegion,
});

const s3 = new AWS.S3();
module.exports = {
    s3,
};