{ self }:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.programs.codexDesktopLinux;
  system = pkgs.stdenv.hostPlatform.system;
  flakePackages = self.packages.${system};
  packageName =
    if cfg.computerUseUi.enable then
      "codex-desktop-computer-use-ui"
    else
      "codex-desktop";
  desktopPackage = if cfg.package != null then cfg.package else flakePackages.${packageName};
in
{
  options.programs.codexDesktopLinux = {
    enable = lib.mkEnableOption "Codex Desktop for Linux";

    package = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = null;
      defaultText = lib.literalExpression ''
        inputs.codex-desktop-control.packages.''${pkgs.stdenv.hostPlatform.system}.codex-desktop
      '';
      description = ''
        Codex Desktop package to install. When unset, the module selects this
        flake's default package or the Computer Use UI variant when
        {option}`programs.codexDesktopLinux.computerUseUi.enable` is set.
      '';
    };

    computerUseUi.enable = lib.mkEnableOption "the Linux Computer Use UI package variant";
  };

  config = lib.mkIf cfg.enable {
    home.packages = [
      desktopPackage
    ];
  };
}
