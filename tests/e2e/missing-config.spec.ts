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

test("native forms retain their same-origin Origin without leaking external referrers", async ({ page, baseURL }) => {
  const response = await page.goto("/en");
  expect(response!.headers()["referrer-policy"]).toBe("same-origin");
  // Exercise a real browser form submission, not fetch's default CORS mode and
  // not an Origin override. Capture it before it reaches any application action.
  const origin = new URL(baseURL!).origin;
  await page.route("**/api/form-origin-probe", route => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ origin: route.request().headers().origin }),
  }));
  await page.evaluate(`(() => {
    const form = document.createElement("form");
    form.action = "/api/form-origin-probe"; form.method = "POST";
    const button = document.createElement("button"); button.textContent = "Submit origin probe";
    form.append(button); document.body.append(form);
  })()`);
  await page.getByRole("button", { name: "Submit origin probe" }).click();
  await expect(page.locator("body")).toContainText(JSON.stringify({ origin }));

  await page.goto("/en");
  await page.route("https://external.example.invalid/**", route => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ referrer: route.request().headers().referer ?? null }),
  }));
  await page.evaluate(`(() => {
    const link = document.createElement("a"); link.href = "https://external.example.invalid/probe";
    link.textContent = "External referrer probe"; document.body.append(link);
  })()`);
  await page.getByRole("link", { name: "External referrer probe" }).click();
  await expect(page.locator("body")).toContainText(JSON.stringify({ referrer: null }));
});
