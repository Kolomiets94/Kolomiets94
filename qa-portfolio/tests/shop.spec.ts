import { test, expect } from '@playwright/test';

const validUser = 'standard_user';
const validPassword = 'secret_sauce';

test('valid user can sign in and see the product catalog', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Username').fill(validUser);
  await page.getByPlaceholder('Password').fill(validPassword);
  await page.locator('[data-test="login-button"]').click();
  await expect(page).toHaveURL(/inventory\.html/);
  await expect(page.locator('.inventory_item')).toHaveCount(6);
});

test('invalid credentials show a visible error', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Username').fill('unknown_user');
  await page.getByPlaceholder('Password').fill('wrong_password');
  await page.locator('[data-test="login-button"]').click();
  await expect(page.locator('[data-test="error"]')).toBeVisible();
  await expect(page).not.toHaveURL(/inventory\.html/);
});

test('user can add and remove a product from the cart', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Username').fill(validUser);
  await page.getByPlaceholder('Password').fill(validPassword);
  await page.locator('[data-test="login-button"]').click();

  await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
  await expect(page.locator('.shopping_cart_badge')).toHaveText('1');
  await page.locator('.shopping_cart_link').click();
  await expect(page.locator('.cart_item')).toHaveCount(1);
  await page.locator('[data-test="remove-sauce-labs-backpack"]').click();
  await expect(page.locator('.cart_item')).toHaveCount(0);
});

test('checkout requires first name', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('Username').fill(validUser);
  await page.getByPlaceholder('Password').fill(validPassword);
  await page.locator('[data-test="login-button"]').click();
  await page.locator('[data-test="add-to-cart-sauce-labs-backpack"]').click();
  await page.locator('.shopping_cart_link').click();
  await page.locator('[data-test="checkout"]').click();
  await page.locator('[data-test="lastName"]').fill('Tester');
  await page.locator('[data-test="postalCode"]').fill('12345');
  await page.locator('[data-test="continue"]').click();
  await expect(page.locator('[data-test="error"]')).toContainText('First Name is required');
});
