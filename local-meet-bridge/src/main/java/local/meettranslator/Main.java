package local.meettranslator;

import local.meettranslator.config.BridgeConfig;

/** Entry point for the local bridge process. */
public final class Main {
    private Main() {
    }

    public static void main(String[] args) throws Exception {
        BridgeConfig config = BridgeConfig.fromEnvironment(System.getenv());
        BridgeServer server = new BridgeServer(config);
        server.start();
    }
}
