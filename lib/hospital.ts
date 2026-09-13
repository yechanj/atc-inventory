import { cookies } from "next/headers";
import { verifyJwt, cookieName } from "@/lib/auth";

export async function getCurrentHospitalId(): Promise<string> {
  const token = cookies().get(cookieName())?.value;
  if (!token) throw new Error("UNAUTHORIZED");
  const payload = await verifyJwt(token);
  if (!payload) throw new Error("UNAUTHORIZED");
  return payload.hospitalId;
}
