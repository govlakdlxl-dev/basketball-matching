import Capacitor
import Security
import UIKit
import UserNotifications

@objc(SessionVaultPlugin)
public final class SessionVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SessionVaultPlugin"
    public let jsName = "SessionVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearBadge", returnType: CAPPluginReturnPromise)
    ]
    private func query(_ call: CAPPluginCall) -> [String: Any]? {
        guard let key = call.getString("key"), key.count <= 256,
              key.hasPrefix("sb-") || key.hasPrefix("basket.") else {
            call.reject("보관소 요청을 확인하지 못했습니다.", "INVALID_VAULT_KEY"); return nil
        }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "dev.basket.pilot.auth", kSecAttrAccount as String: key]
    }
    @objc public func getItem(_ call: CAPPluginCall) {
        guard var q = query(call) else { return }
        q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?; let status = SecItemCopyMatching(q as CFDictionary, &item)
        if status == errSecItemNotFound { call.resolve(["value": NSNull()]); return }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            call.reject("보관소를 사용할 수 없습니다.", "VAULT_UNAVAILABLE"); return
        }
        call.resolve(["value": value])
    }
    @objc public func setItem(_ call: CAPPluginCall) {
        guard var q = query(call), let value = call.getString("value"), let data = value.data(using: .utf8), data.count <= 65536 else { call.reject("보관소 입력이 유효하지 않습니다.", "INVALID_VAULT_VALUE"); return }
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(q as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound { q.merge(attributes) { _, new in new }; status = SecItemAdd(q as CFDictionary, nil) }
        if status == errSecSuccess { call.resolve() } else { call.reject("보관소를 사용할 수 없습니다.", "VAULT_UNAVAILABLE") }
    }
    @objc public func removeItem(_ call: CAPPluginCall) {
        guard let q = query(call) else { return }; let status = SecItemDelete(q as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { call.resolve() } else { call.reject("보관소를 사용할 수 없습니다.", "VAULT_UNAVAILABLE") }
    }
    @objc public func clearBadge(_ call: CAPPluginCall) {
        if #available(iOS 16.0, *) {
            UNUserNotificationCenter.current().setBadgeCount(0) { error in
                if error == nil { call.resolve() } else { call.reject("배지를 정리하지 못했습니다.", "BADGE_UNAVAILABLE") }
            }
        } else { DispatchQueue.main.async { UIApplication.shared.applicationIconBadgeNumber = 0; call.resolve() } }
    }
}
