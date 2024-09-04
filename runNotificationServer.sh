pm2 stop 6666
timeStamp=$(date +%d%h%y_%H_%M_%S)
notificationChecker=1 pm2 start -f server.js --name 6666 --log-date-format "YYYY-MM-DD HH:mm Z" -- 6666
