import AppKit
import Foundation
import WebKit

enum RenderError: Error {
    case invalidArguments
    case javascript(String)
    case snapshotFailed
    case imageEncodingFailed
}

@MainActor
final class ResumeRenderer: NSObject, WKNavigationDelegate {
    private let url: URL
    private let pdfURL: URL
    private let pngURL: URL
    private let exportMode: Bool
    private let webView: WKWebView
    private let window: NSWindow
    private var continuation: CheckedContinuation<Void, Error>?

    init(url: URL, pdfURL: URL, pngURL: URL, exportMode: Bool) {
        self.url = url
        self.pdfURL = pdfURL
        self.pngURL = pngURL
        self.exportMode = exportMode

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        self.webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 2200), configuration: configuration)
        self.window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 2200),
            styleMask: [.titled],
            backing: .buffered,
            defer: false
        )

        super.init()

        window.contentView = webView
        window.orderOut(nil)
        webView.navigationDelegate = self
    }

    func render() async throws {
        webView.load(URLRequest(url: url))
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            self.continuation = continuation
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            do {
                try await Task.sleep(nanoseconds: 4_000_000_000)

                if exportMode {
                    _ = try await evaluate("document.body.classList.add('pdf-export'); true;")
                    try await Task.sleep(nanoseconds: 750_000_000)
                }

                let width = max(1440, Int(try await evaluateDouble("Math.max(document.documentElement.scrollWidth, document.body.scrollWidth, 1440)")))
                let height = max(2200, Int(try await evaluateDouble("Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 2200)")))
                let size = CGSize(width: width, height: height)

                webView.setFrameSize(size)
                window.setContentSize(size)

                try await Task.sleep(nanoseconds: 750_000_000)
                try await writePDF(size: size)
                try await writePreviewPNG(size: CGSize(width: size.width, height: min(size.height, 2600)))

                continuation?.resume()
                continuation = nil
            } catch {
                continuation?.resume(throwing: error)
                continuation = nil
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        continuation?.resume(throwing: error)
        continuation = nil
    }

    private func evaluate(_ javascript: String) async throws -> Any {
        try await withCheckedThrowingContinuation { continuation in
            webView.evaluateJavaScript(javascript) { result, error in
                if let error {
                    continuation.resume(throwing: RenderError.javascript(error.localizedDescription))
                    return
                }
                continuation.resume(returning: result as Any)
            }
        }
    }

    private func evaluateDouble(_ javascript: String) async throws -> Double {
        let result = try await evaluate(javascript)
        if let number = result as? NSNumber {
            return number.doubleValue
        }
        if let value = result as? Double {
            return value
        }
        throw RenderError.javascript("Expected numeric result from JavaScript")
    }

    private func writePDF(size: CGSize) async throws {
        let configuration = WKPDFConfiguration()
        configuration.rect = CGRect(origin: .zero, size: size)

        let data: Data = try await withCheckedThrowingContinuation { continuation in
            webView.createPDF(configuration: configuration) { result in
                switch result {
                case .success(let data):
                    continuation.resume(returning: data)
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }

        try data.write(to: pdfURL)
    }

    private func writePreviewPNG(size: CGSize) async throws {
        let configuration = WKSnapshotConfiguration()
        configuration.rect = CGRect(origin: .zero, size: size)

        let image: NSImage = try await withCheckedThrowingContinuation { continuation in
            webView.takeSnapshot(with: configuration) { image, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                guard let image else {
                    continuation.resume(throwing: RenderError.snapshotFailed)
                    return
                }
                continuation.resume(returning: image)
            }
        }

        guard
            let tiff = image.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiff),
            let png = bitmap.representation(using: .png, properties: [:])
        else {
            throw RenderError.imageEncodingFailed
        }

        try png.write(to: pngURL)
    }
}

@main
struct Main {
    static func main() async {
        guard CommandLine.arguments.count >= 4 else {
            fputs("usage: render_resume.swift <url> <pdf-output> <png-output>\n", stderr)
            exit(1)
        }

        let urlString = CommandLine.arguments[1]
        let pdfOutput = URL(fileURLWithPath: CommandLine.arguments[2])
        let pngOutput = URL(fileURLWithPath: CommandLine.arguments[3])

        guard let url = URL(string: urlString) else {
            fputs("invalid url: \(urlString)\n", stderr)
            exit(1)
        }

        NSApplication.shared.setActivationPolicy(.prohibited)

        do {
            let renderer = ResumeRenderer(url: url, pdfURL: pdfOutput, pngURL: pngOutput, exportMode: true)
            try await renderer.render()
        } catch {
            fputs("render failed: \(error)\n", stderr)
            exit(1)
        }
    }
}
