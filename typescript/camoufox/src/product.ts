/**
 * Camoufox as camoucore sees it: its name, cache directory and environment
 * variable prefix (CAMOUFOX_*), on the Firefox engine, with the site where
 * accounts are made.
 *
 * TypeScript twin of python/camoufox/src/camoufox/product.py.
 */
import { FIREFOX, Product } from "camoucore/product.js";

export const PRODUCT = new Product(
	"camoufox",
	"Camoufox",
	FIREFOX,
	"https://camoufox.com",
);
