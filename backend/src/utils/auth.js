import { AppError } from "./errors.js";

export async function getAuthUser(request) {
  try {
    await request.jwtVerify();
  } catch (_error) {
    throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const userId = request.user?.sub;
  const role = request.user?.role || "player";
  if (!userId) {
    throw new AppError("Invalid token payload", 401, "UNAUTHORIZED");
  }

  return {
    id: userId,
    role
  };
}

export async function requireAdmin(request) {
  const user = await getAuthUser(request);
  if (user.role !== "admin") {
    throw new AppError("Admin role required", 403, "FORBIDDEN");
  }
  return user;
}
