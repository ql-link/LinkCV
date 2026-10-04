import Foundation
import Security
import LocalAuthentication

public struct KeychainStoreError: Error, Sendable {
    public let status: OSStatus
}

/// One encoded record per origin/channel/app. Never delete before replacing it.
public struct KeychainTokenStore: TokenStore {
    private let service: String

    public init(service: String = "com.linkresume.desktop.credentials") {
        self.service = service
    }

    private func query(_ scope: String) -> [CFString: Any] {
        let context = LAContext()
        context.interactionNotAllowed = true
        return [kSecClass: kSecClassGenericPassword, kSecAttrService: service,
         kSecAttrAccount: scope, kSecAttrSynchronizable: false,
         kSecUseAuthenticationContext: context]
    }

    public func load(scope: String) throws -> DesktopCredentialRecord? {
        var query = query(scope)
        query[kSecReturnData] = true
        query[kSecMatchLimit] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainStoreError(status: status) }
        guard let data = result as? Data else { throw APIError.invalidResponse }
        return try JSONDecoder().decode(DesktopCredentialRecord.self, from: data)
    }

    public func save(_ record: DesktopCredentialRecord, scope: String) throws {
        let attributes: [CFString: Any] = [kSecValueData: try JSONEncoder().encode(record),
            kSecAttrAccessible: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        let status = SecItemUpdate(query(scope) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let item = query(scope).merging(attributes) { _, new in new }
            let added = SecItemAdd(item as CFDictionary, nil)
            guard added == errSecSuccess else { throw KeychainStoreError(status: added) }
        } else if status != errSecSuccess {
            throw KeychainStoreError(status: status)
        }
    }

    public func clear(scope: String) throws {
        let status = SecItemDelete(query(scope) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainStoreError(status: status)
        }
    }
}
