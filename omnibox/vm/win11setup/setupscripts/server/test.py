from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    # Channel can be "chrome", "msedge", "chrome-beta", "msedge-beta" or "msedge-dev".
    browser = p.chromium.launch(channel="chrome", headless=False)
    page = browser.new_page()
    page.goto("http://playwright.dev")
    print(page.title())
    
    # Extract and display all text content from the page
    text_content = page.content()
    print("\nPage content:")
    print(page.evaluate('() => document.body.innerText'))
    
    browser.close()