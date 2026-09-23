import { expect, test } from "@playwright/test";

test("missing Clerk configuration keeps the portal visibly unavailable", async ({ page, request }) => {
  await page.goto("/en");
  await expect(page.getByRole("heading", { name: "Sign-in is not connected yet" })).toBeVisible();
  await expect(page.getByText("Authentication configuration is pending.")).toBeVisible();
  await expect(page.getByText("Sign in to the portal")).toHaveAttribute("aria-disabled", "true");

  const readiness = await request.get("/api/health/ready");
  expect(readiness.status()).toBe(503);
  await expect(readiness.json()).resolves.toEqual({ status: "unavailable", dependency: "authentication" });
});
