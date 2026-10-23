import UIKit
import UniformTypeIdentifiers

// The extension stores links locally; the containing app imports them on its next activation.
final class ShareViewController: UIViewController {
    private let group = "group.com.myreelsmap.app"
    private var memberId: String?
    private var key: String { "sharedReels." + (memberId ?? "") }
    private let message = UILabel()
    private let save = UIButton(type: .system)
    private var links: [String] = []

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let title = UILabel()
        title.text = "릴스맛집지도에 보관"
        title.font = .preferredFont(forTextStyle: .title2)
        message.numberOfLines = 0
        message.text = "공유받은 링크를 확인하고 있어요…"
        save.setTitle("릴스 보관", for: .normal)
        save.isEnabled = false
        save.addTarget(self, action: #selector(store), for: .touchUpInside)
        let cancel = UIButton(type: .system)
        cancel.setTitle("닫기", for: .normal)
        cancel.addTarget(self, action: #selector(close), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [title, message, save, cancel])
        stack.axis = .vertical
        stack.spacing = 24
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor)
        ])
        let defaults = UserDefaults(suiteName: group)
        memberId = defaults?.string(forKey: "memberId")
        guard memberId != nil, (defaults?.double(forKey: "memberUntil") ?? 0) > Date().timeIntervalSince1970 else {
            message.text = "릴스 보관은 회원 전용이에요. 릴스맛집지도 앱에서 회원가입·로그인한 뒤 다시 공유해 주세요."
            return
        }
        readItems()
    }

    private func readItems() {
        let pending = DispatchGroup()
        let lock = NSLock()
        var found: [String] = []
        for item in extensionContext?.inputItems as? [NSExtensionItem] ?? [] {
            let content = item.attributedContentText?.string ?? ""
            lock.lock(); found.append(contentsOf: instagramLinks(content)); lock.unlock()
            for provider in item.attachments ?? [] {
                let type = provider.hasItemConformingToTypeIdentifier(UTType.url.identifier)
                    ? UTType.url.identifier : UTType.plainText.identifier
                guard provider.hasItemConformingToTypeIdentifier(type) else { continue }
                pending.enter()
                provider.loadItem(forTypeIdentifier: type, options: nil) { value, _ in
                    let text = (value as? URL)?.absoluteString ?? (value as? String) ?? ""
                    let urls = self.instagramLinks(text)
                    lock.lock(); found.append(contentsOf: urls); lock.unlock()
                    pending.leave()
                }
            }
        }
        pending.notify(queue: .main) {
            self.links = Array(Set(found)).sorted()
            self.save.isEnabled = !self.links.isEmpty
            self.message.text = self.links.isEmpty
                ? "Instagram 릴스나 게시물 링크가 없어요. 인스타에서 ‘공유 → 더 보기’로 다시 보내주세요."
                : "릴스 \(self.links.count)개를 보관할 수 있어요. 보관 후 릴스맛집지도 앱을 열면 확인할 수 있습니다."
        }
    }

    private func instagramLinks(_ text: String) -> [String] {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return [] }
        return detector.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap { match in
            guard let url = match.url, url.scheme == "https",
                  ["instagram.com", "www.instagram.com", "m.instagram.com"].contains(url.host?.lowercased() ?? ""),
                  let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
            let segments = parts.path.split(separator: "/")
            guard segments.count >= 2, ["reel", "reels", "p"].contains(String(segments[0])) else { return nil }
            return "https://www.instagram.com/\(segments[0] == "reels" ? "reel" : String(segments[0]))/\(segments[1])/"
        }
    }

    @objc private func store() {
        guard let defaults = UserDefaults(suiteName: group),
              FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil else {
            message.text = "공유 저장 공간을 사용할 수 없어요. 앱 설정을 확인해 주세요."
            return
        }
        guard let id = memberId, defaults.string(forKey: "memberId") == id,
              defaults.double(forKey: "memberUntil") > Date().timeIntervalSince1970 else {
            save.isEnabled = false
            message.text = "릴스맛집지도 앱에서 다시 로그인한 뒤 공유해 주세요."
            return
        }
        var existing = defaults.stringArray(forKey: key) ?? []
        for link in links where !existing.contains(link) { existing.append(link) }
        defaults.set(existing, forKey: key)
        save.isEnabled = false
        message.text = "보관했어요. 릴스맛집지도 앱을 열어 ‘공유받은 릴스’를 확인해 주세요."
    }
    @objc private func close() { extensionContext?.completeRequest(returningItems: nil) }
}
