cask "pond" do
  arch arm: "arm64", intel: "x64"

  version "2.2.0"
  sha256 arm:   "1a3c48b83e0084be5753c27d221a8749b51e57eb1a8d443225b976a73cfe6aca",
         intel: "8c90553961d627ee9f44868e2ed14a3bc2c0100db39e9e5ceaefa77560450c35"

  url "https://github.com/raphaelsalaja/pond/releases/download/v#{version}/Pond-#{version}-#{arch}.dmg"
  name "Pond"
  desc "Local-first archive for things you save from the web"
  homepage "https://github.com/raphaelsalaja/pond"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: :ventura

  app "Pond.app"

  zap trash: [
    "~/Library/Application Support/pond",
    "~/Library/Logs/pond",
    "~/Library/Preferences/so.pond.desktop.plist",
  ]
end
