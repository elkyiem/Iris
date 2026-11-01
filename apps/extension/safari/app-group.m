//
//  app-group.m
//  Opens Pond's app group container the way macOS expects, from Pond's main process.
//
//  Since macOS 15, an unsandboxed app may not create ~/Library/Group Containers/<group> by
//  hand, nor a file inside a container the sandboxed extension created first: app data
//  protection answers EPERM. Asking containermanagerd for the container through
//  containerURLForSecurityApplicationGroupIdentifier: creates it when missing and admits
//  this app, after which plain file APIs work in it.
//
//  Exports containerPath(identifier: string): string | null. On macOS the system returns
//  the path even for a group the app is not entitled to, so a path is not proof of
//  access; null only means no URL came back. Built by build-safari-extension.mjs into
//  Pond.app/Contents/Resources.
//

#import <Foundation/Foundation.h>
#include <node_api.h>
#include <stdlib.h>

static napi_value ContainerPath(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value argv[1];
    napi_get_cb_info(env, info, &argc, argv, NULL, NULL);

    size_t length = 0;
    if (argc < 1 || napi_get_value_string_utf8(env, argv[0], NULL, 0, &length) != napi_ok) {
        napi_throw_type_error(env, NULL, "containerPath takes an app group identifier");
        return NULL;
    }
    char *identifier = malloc(length + 1);
    napi_get_value_string_utf8(env, argv[0], identifier, length + 1, &length);
    NSString *group = [NSString stringWithUTF8String:identifier];
    free(identifier);

    NSURL *url = [NSFileManager.defaultManager containerURLForSecurityApplicationGroupIdentifier:group];
    napi_value result;
    if (url == nil) {
        napi_get_null(env, &result);
        return result;
    }
    napi_create_string_utf8(env, url.path.fileSystemRepresentation, NAPI_AUTO_LENGTH, &result);
    return result;
}

NAPI_MODULE_INIT() {
    napi_value function;
    napi_create_function(env, "containerPath", NAPI_AUTO_LENGTH, ContainerPath, NULL, &function);
    napi_set_named_property(env, exports, "containerPath", function);
    return exports;
}
