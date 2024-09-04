module.exports = {
    userModel: require('./user'),    
    workspaceModel: require('./workspace'),    
    channelModel: require('./channel'),    
    messageModel: require('./message'),
    userWorkspaceDataModel: require('./userWorkspaceData'),
    userChannelDataModel: require('./userChannelData'),
    notificationModel: require('./notification'),
    workspaceNotificationSettingsModel: require('./workspaceNotificationSettings'),
    userActivityModel: require("./userActivity"),
}