timeStamp=$(date +%d%h%y_%H_%M_%S)
#pm2 stop all
#pm2 delete all
pm2 delete 3002
#pm2 stop 4002
pm2 start -f server.js --name 3002 --log-date-format "YYYY-MM-DD HH:mm Z" -- 3002
#pm2 start -f server.js --name 4002 --log-date-format "YYYY-MM-DD HH:mm Z" -- 4002
