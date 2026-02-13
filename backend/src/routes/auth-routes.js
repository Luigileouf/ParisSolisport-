import { pool } from "../db.js";
import { config } from "../config.js";
import { AppError } from "../utils/errors.js";

export default async function authRoutes(fastify) {
  fastify.post("/auth/login", async (request) => {
    const { email, password } = request.body ?? {};

    if (!email || !password) {
      throw new AppError("email and password are required", 400, "INVALID_PAYLOAD");
    }

    const result = await pool.query(
      `SELECT id, email, display_name, role
       FROM users
       WHERE email = $1
         AND password_hash <> ''
         AND password_hash = crypt($2, password_hash)`,
      [email, password]
    );

    if (result.rowCount === 0) {
      throw new AppError("Invalid credentials", 401, "INVALID_CREDENTIALS");
    }

    const user = result.rows[0];
    const accessToken = fastify.jwt.sign(
      {
        role: user.role,
        email: user.email
      },
      {
        sub: user.id,
        expiresIn: config.jwtExpiresIn
      }
    );

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: config.jwtExpiresIn,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role
      }
    };
  });
}
