import dotenv from "dotenv";

dotenv.config();

function getInt(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return parsed;
}

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: getInt("PORT", 3000),
  databaseUrl: process.env.DATABASE_URL || "",
  logLevel: process.env.LOG_LEVEL || "info",
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1h",
  betStakeMin: getInt("BET_STAKE_MIN", 5),
  betStakeMax: getInt("BET_STAKE_MAX", 50),
  adRewardPoints: getInt("AD_REWARD_POINTS", 20),
  adRewardMaxPerDay: getInt("AD_REWARD_MAX_PER_DAY", 5),
  adRewardMaxPointsPerDay: getInt("AD_REWARD_MAX_POINTS_PER_DAY", 100)
};

if (!config.databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

if (!config.jwtSecret) {
  throw new Error("JWT_SECRET is required");
}
