timeStamp=$(date +%d%h%y_%H_%M_%S)
#pm2 stop all
#pm2 delete all
pm2 stop 5555
pm2 stop 5556
pm2 start -f server.js --name 5555 --log-date-format "YYYY-MM-DD HH:mm Z" -- 5555
pm2 start -f server.js --name 5556 --log-date-format "YYYY-MM-DD HH:mm Z" -- 5556
