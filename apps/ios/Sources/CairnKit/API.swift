import Foundation
import Security

public struct APIError: LocalizedError {
    public let code: String
    public let message: String
    public var errorDescription: String? { message }
}
public struct CairnAPI: Sendable {
    public let baseURL: URL
    public let token: String?
    public init(baseURL: URL, token: String? = nil) { self.baseURL = baseURL; self.token = token }
    public func request(_ path: String, method: String = "GET", body: JSON? = nil, query: [String: String] = [:]) async throws -> JSON {
        guard var components = URLComponents(url: baseURL.appendingPathComponent("v1").appendingPathComponent(path), resolvingAgainstBaseURL: false) else { throw APIError(code: "CONFIG", message: "Enter a valid API address.") }
        if !query.isEmpty { components.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let url = components.url else { throw APIError(code: "CONFIG", message: "Invalid API address.") }
        var request = URLRequest(url: url); request.httpMethod = method; request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token, !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONEncoder().encode(body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError(code: "NETWORK", message: "The server did not respond.") }
        let json = (try? JSONDecoder().decode(JSON.self, from: data)) ?? .null
        guard (200..<300).contains(http.statusCode) else {
            throw APIError(code: json["error"]["code"].text, message: json["error"]["message"].text.isEmpty ? "The server returned \(http.statusCode). Please try again." : json["error"]["message"].text)
        }
        guard json.exists else { throw APIError(code: "CONTRACT", message: "The server returned an unreadable response.") }
        return json
    }
}

enum SessionKeychain {
    static func read(_ account: String = "token") -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "tech.cairn.client", kSecAttrAccount as String: account, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
    static func write(_ value: String?, account: String = "token") throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "tech.cairn.client", kSecAttrAccount as String: account]
        let deleted = SecItemDelete(query as CFDictionary)
        guard deleted == errSecSuccess || deleted == errSecItemNotFound else { throw APIError(code: "KEYCHAIN", message: "Could not update secure sign-in storage.") }
        if let value {
            var item = query; item[kSecValueData as String] = Data(value.utf8); item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw APIError(code: "KEYCHAIN", message: "Could not securely save your sign-in.") }
        }
    }
}
