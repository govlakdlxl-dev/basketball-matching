import Capacitor
import WebKit

final class MainFrameBridgeHandler: NSObject, WKScriptMessageHandler {
    private let downstream: WKScriptMessageHandler
    private let localURL: URL
    init(downstream: WKScriptMessageHandler, localURL: URL) {
        self.downstream = downstream; self.localURL = localURL
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let source = message.frameInfo.request.url,
              source.scheme == localURL.scheme, source.host == localURL.host,
              source.port == localURL.port else { return }
        downstream.userContentController(userContentController, didReceive: message)
    }
}

final class BasketViewController: CAPBridgeViewController {
    private var guardedHandler: MainFrameBridgeHandler?
    override func capacitorDidLoad() {
        guard let concrete = bridge as? CapacitorBridge, let webView = webView else { return }
        let handler = MainFrameBridgeHandler(downstream: concrete.webViewDelegationHandler, localURL: concrete.config.localURL)
        guardedHandler = handler
        let controller = webView.configuration.userContentController
        controller.removeScriptMessageHandler(forName: "bridge")
        controller.add(handler, name: "bridge")
        concrete.registerPluginInstance(SessionVaultPlugin())
    }
}
