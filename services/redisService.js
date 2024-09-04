/** @typedef {import("ioredis").RedisCommander} RedisCommander */
/** @typedef {import("ioredis").Redis} Redis*/



/**
 * 
 * @param {Redis} redis 
 * @param {string[]} args 
 * @returns 
 */
function redisExecutor(redis, args) {
    let redisCommand = args.shift();
    return redis[redisCommand].apply(redis,args);
}


module.exports = {
    /** @type {<K extends keyof RedisCommander>(method: K, ...args: Parameters<RedisCommander[K]>) => ReturnType<RedisCommander[K]>} */
    redis: (...args) => {
        return redisExecutor(global.redisClient, args);
    },
    /** @type {<K extends keyof RedisCommander>(method: K, ...args: Parameters<RedisCommander[K]>) => ReturnType<RedisCommander[K]>} */
    sessionRedis: (...args) => {
        return redisExecutor(global.sessionRedisClient, args);
    }
}