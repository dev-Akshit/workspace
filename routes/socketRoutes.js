const {channelController, messageController, notificationController, userController} = require("../controllers");
const {redisService} = require("../services");
const {constants, utils} = require('../lib');
const controllers = require("../controllers");
const {redisKeys} = constants;

module.exports = function(socket, io) {
    socket.on('hello', (data) => {
        console.log("Socket hello");
    })

    socket.on('joinWorkspace', async (payload, ack) => {
        try {
            const {workspaceId} = payload;
            if ( ! workspaceId )      throw new Error("WorkspaceId is null");
            
            const userId = socket.userData.userId;

            socket.join(workspaceId);
            console.log(`UserId ${userId} joined the workspace ${workspaceId}`);
            userController.setLastActiveData({workspaceId, userId});
            if (ack)    ack();
        } catch (error) {
            console.log("Error in joinWorkspace. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('leaveWorkspace', async (payload, ack) => {
        try {
            const {workspaceId} = payload;
            if ( ! workspaceId )      throw new Error("WorkspaceId is null");
            
            const userId = socket.userData.userId;

            socket.leave(workspaceId);
            console.log(`UserId ${userId} leaved the workspace ${workspaceId}`);
            if (ack)    ack();
        } catch (error) {
            console.log("Error in joinWorkspace. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('joinChannel', async (payload, ack) => {
        try {
            const { workspaceId, channelId } = payload;
            if ( ! workspaceId )    throw new Error("WorkspaceId is null");
            if ( ! channelId )      throw new Error("ChannelId is null");

            const userId = socket.userData.userId;
            socket.join(channelId);

            redisService.redis('hmset', `${redisKeys.socketDataHash}:${socket.id}`, `${redisKeys.channelId}`, channelId, `${redisKeys.userId}`, userId, (err) => {
                redisService.redis('expire', `${redisKeys.socketDataHash}:${socket.id}`, constants.rediskeyExpiryTimesInSec.userDataHash);
            });

            channelController.setLastSeenOfChannel({channelId, userId});
            userController.setLastActiveData({workspaceId, channelId, userId});

            let userChannelDataObj = await channelController.getUserChannelDataObj({channelId, userId}) || {};

            console.log(`UserId ${userId} joined the channel ${channelId}`);
            if (ack)    ack(userChannelDataObj);

            io.to(channelId).emit('userJoinedChannel', {userId, channelId});

        } catch (error) {
            console.log("Error in joinChannel. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('leaveChannel', async (payload, ack) => {
        try {
            const { channelId } = payload;
            if ( ! channelId )      throw new Error("ChannelId is null");
            
            const userId = socket.userData.userId;

            socket.leave(channelId);
            channelController.setLastSeenOfChannel({channelId, userId});

            redisService.redis('del', `${redisKeys.userChannelDataHash}:${userId}`);

            console.log(`UserId ${userId} leaved the channel ${channelId}`);
            if (ack)    ack();

            io.to(channelId).emit('userLeftChannel', {userId, channelId});

        } catch (error) {
            console.log("Error in joinChannel. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('message', async (payload, ack) => {
        try {
            const {eventType, workspaceId, channelId} = payload;
            if ( ! channelId )      throw new Error("ChannelId is null");
            
            payload.userId = socket.userData.userId;
            let data;
            switch (eventType) {
                case constants.messageEventType.addType:
                    data = await messageController.addMessageInRedisStream(payload);
                    break;
                case constants.messageEventType.editType:
                    data = await messageController.editMessage(payload);
                    break;
                case constants.messageEventType.deleteType:
                    data = await messageController.deleteMessage(payload);
                    break;
                default:
                    throw new Error("Event Type is not valid");
            }
            let obj = {payload, ...data}
            io.to(channelId).emit('message', obj);
            if (ack)    ack(obj);
        } catch (error) {
            console.log("Error in joinChannel. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('reply', async (payload, ack) => {
        try {
            const {eventType, channelId} = payload;
            if ( ! channelId )      throw new Error("ChannelId is null");
            
            payload.userId = socket.userData.userId;
            let data;
            switch (eventType) {
                case constants.replyEventType.addType:
                    data = await messageController.addReply(payload);
                    break;
                case constants.replyEventType.editType:
                    data = await messageController.editReply(payload);
                    break;
                case constants.replyEventType.deleteType:
                    data = await messageController.deleteReply(payload);
                    break;
                default:
                    throw new Error("Event Type is not valid");
            }
            let obj = {payload, ...data}
            io.to(channelId).emit('reply', obj);
            if (ack)    ack(obj);
        } catch (error) {
            console.log("Error in reply. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('notificationsCount', async (payload, ack) => {
        try {
            payload.userId = socket.userData.userId;
            let count = await notificationController.countUnreadNotifications(payload);
            socket.emit('notificationsCount', {count});
            if (ack)    ack({count});
        } catch (error) {
            console.log("Error in notificationsCount. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('notificationsList', async (payload, ack) => {
        try {
            payload.userId = socket.userData.userId;
            let data = await notificationController.listNotifications(payload);
            socket.emit('notificationsList', data);
            if (ack)    ack(data);
        } catch (error) {
            console.log("Error in notificationsList. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('notificationRead', async (payload, ack) => {
        try {
            let data = await notificationController.changeStatusToRead(payload);
            if (ack)    ack(data);
        } catch (error) {
            console.log("Error in notificationRead. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('setNotificationLastRead', async (payload, ack) => {
        try {
            payload.userId = socket.userData.userId;
            let data = await notificationController.setNotificationLastSeen(payload);
            if (ack)    ack(data);
        } catch (error) {
            console.log("Error in setNotificationLastRead. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('isResolved', async (payload, ack) => {
        try {
            payload.userId = socket.userData.userId;

            let data = await messageController.setIsResolvedOfMessage(payload);
            if (ack)    ack(data);
        } catch (error) {
            console.log("Error in setIsResolvedOfMessage. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('isDiscussionRequired', async (payload, ack) => {
        try {
            payload.userId = socket.userData.userId;
            let data = await messageController.setIsDiscussionRequiredOfMessage(payload);
            if (ack)    ack(data);
        } catch (error) {
            console.log("Error in setIsDiscussionRequiredOfMessage. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('updateNotifyUser', async (payload, ack) => {
        try {
            payload.userId = socket.userData.userId;
            let data = await messageController.updateNotifyUsersListOfMessage(payload);
            if (ack)    ack(data);
        } catch (error) {
            console.log("Error in updateNotifyUsersListOfMessage. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('likeMessage', async (payload, ack) => {
        try {
            payload.userId = socket.userData.userId;
            let data = await messageController.updateLikedBy(payload);
            if (ack)    ack(data);
        } catch (error) {
            console.log("Error in updateLikedBy. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('unLikeMessage', async (payload, ack) => {
        try {
            payload.userId = socket.userData.userId;
            let data = await messageController.updateUnlikedBy(payload);
            if (ack)    ack(data);
        } catch (error) {
            console.log("Error in updateUnlikedBy. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('getOnlineUsersListInChannel', async (payload = {}, ack) => {
        try {
            const channelId = payload.channelId;
            if ( ! channelId )  throw new Error("ChannelId is null");

            let userIdsSet = await utils.getOnlineUserIdsSetInChannelRoom(channelId);
            if (ack)    ack({userIds: [...userIdsSet]});
        } catch (error) {
            console.log("Error in getOnlineUsersListInChannel. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('setPinMessage', async (payload = {}, ack) => {
        try {
            payload.userId = socket.userData.userId;
            let obj = await channelController.setPinMessage(payload) || {};
            if (ack)    ack(obj);
        } catch (error) {
            console.log("Error in setPinMessage. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('removePinMessage', async (payload = {}, ack) => {
        try {
            payload.userId = socket.userData.userId;
            let obj = await channelController.removePinMessage(payload) || {};
            if (ack)    ack(obj);
        } catch (error) {
            console.log("Error in removePinMessage. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })

    socket.on('getTotalUnreadMessagesCount', async (payload = {}, ack) => {
        try {
            payload.userId = socket.userData.userId;
            const totalUnreadMessagesCount = 0; //await channelController.getTotalUnreadMessagesCount(payload) || 0;
            //console.log('unread-obj',totalUnreadMessagesCount)
            if (ack)    ack({totalUnreadMessagesCount});
        } catch (error) {
            console.log("Error in getTotalUnreadMessagesCount. Error = ", error);
            socket.emit('error', error);
            if (ack)    ack({error: error.message});
        }
    })
}
