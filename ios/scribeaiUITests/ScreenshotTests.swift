import XCTest

@MainActor
class ScreenshotTests: XCTestCase {
    let app = XCUIApplication()

    override func setUp() {
        continueAfterFailure = false
        setupSnapshot(app)
        app.launch()
    }

    func testScreenshots() {
        sleep(3)
        // Home/notes list
        snapshot("01_NotesList")

        // Try tapping profile button if visible
        if app.buttons["person.circle.fill"].exists {
            app.buttons["person.circle.fill"].tap()
            sleep(1)
            snapshot("02_Profile")
            // Dismiss
            app.swipeDown()
            sleep(1)
        }

        snapshot("03_HomeMain")
    }
}
