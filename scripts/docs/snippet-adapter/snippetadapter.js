/**
 * @license Copyright (c) 2003-2017, CKSource - Frederico Knabben. All rights reserved.
 * For licensing, see LICENSE.md.
 */

/* eslint-env node */

const path = require( 'path' );
const fs = require( 'fs' );
const webpack = require( 'webpack' );
const { bundler, styles: { getPostCssConfig } } = require( '@ckeditor/ckeditor5-dev-utils' );
const CKEditorWebpackPlugin = require( '@ckeditor/ckeditor5-dev-webpack-plugin' );
const ExtractTextPlugin = require( 'extract-text-webpack-plugin' );
const BabelMinifyPlugin = require( 'babel-minify-webpack-plugin' );

const webpackProcesses = new Map();

module.exports = function snippetAdapter( data ) {
	if ( !data.snippetSource.js ) {
		throw new Error( `Missing snippet source for "${ data.snippetPath }".` );
	}

	const snippetConfig = readSnippetConfig( data.snippetSource.js );
	const outputPath = path.join( data.outputPath, data.snippetPath );

	const webpackConfig = getWebpackConfig( {
		entry: data.snippetSource.js,
		outputPath,
		language: snippetConfig.language,
		minify: data.options.production
	} );

	let promise;

	// See #530.
	if ( webpackProcesses.has( outputPath ) ) {
		promise = webpackProcesses.get( outputPath );
	} else {
		promise = runWebpack( webpackConfig );
		webpackProcesses.set( outputPath, promise );
	}

	return promise
		.then( () => {
			const wasCSSGenerated = fs.existsSync( path.join( outputPath, 'snippet.css' ) );
			const cssFiles = [
				path.join( data.basePath, 'assets', 'snippet-styles.css' )
			];

			// CSS may not be generated by Webpack if a snippet's JS file didn't import any SCSS files.
			if ( wasCSSGenerated ) {
				cssFiles.unshift( path.join( data.relativeOutputPath, data.snippetPath, 'snippet.css' ) );
			}

			// If the snippet is a dependency of a parent snippet, append JS and CSS to HTML and save to disk.
			if ( data.isDependency ) {
				let htmlFile = fs.readFileSync( data.snippetSource.html ).toString();

				if ( wasCSSGenerated ) {
					htmlFile += '<link rel="stylesheet" href="snippet.css" type="text/css">';
				}

				htmlFile += '<script src="snippet.js"></script>';

				fs.writeFileSync( path.join( outputPath, 'snippet.html' ), htmlFile );
			}

			return {
				html: fs.readFileSync( data.snippetSource.html ),
				assets: {
					js: [
						path.join( data.relativeOutputPath, data.snippetPath, 'snippet.js' )
					],
					css: cssFiles
				},
				dependencies: snippetConfig.dependencies
			};
		} );
};

function getWebpackConfig( config ) {
	const plugins = [
		new ExtractTextPlugin( 'snippet.css' ),
		new CKEditorWebpackPlugin( {
			language: config.language || 'en'
		} ),
		new webpack.BannerPlugin( {
			banner: bundler.getLicenseBanner(),
			raw: true
		} )
	];

	if ( config.minify ) {
		plugins.push(
			new BabelMinifyPlugin( null, {
				comments: false
			} )
		);
	}

	return {
		devtool: 'source-map',

		entry: config.entry,

		output: {
			path: config.outputPath,
			filename: 'snippet.js'
		},

		plugins,

		// Configure the paths so building CKEditor 5 snippets work even if the script
		// is triggered from a directory outside ckeditor5 (e.g. multi-project case).
		resolve: {
			modules: getModuleResolvePaths()
		},

		resolveLoader: {
			modules: getModuleResolvePaths()
		},

		module: {
			rules: [
				{
					test: /\.svg$/,
					use: [ 'raw-loader' ]
				},
				{
					test: /\.css$/,
					use: ExtractTextPlugin.extract( {
						fallback: 'style-loader',
						use: [
							{
								loader: 'postcss-loader',
								options: getPostCssConfig( {
									themeImporter: {
										themePath: require.resolve( '@ckeditor/ckeditor5-theme-lark' )
									},
									minify: config.minify
								} )
							}
						]
					} )
				}
			]
		}
	};
}

function runWebpack( webpackConfig ) {
	return new Promise( ( resolve, reject ) => {
		webpack( webpackConfig, ( err, stats ) => {
			if ( err ) {
				reject( err );
			} else if ( stats.hasErrors() ) {
				reject( new Error( stats.toString() ) );
			} else {
				resolve();
			}
		} );
	} );
}

function getModuleResolvePaths() {
	return [
		path.resolve( __dirname, '..', '..', '..', 'node_modules' ),
		'node_modules'
	];
}

function readSnippetConfig( snippetSourcePath ) {
	const snippetSource = fs.readFileSync( snippetSourcePath ).toString();

	const configSourceMatch = snippetSource.match( /\n\/\* config ([\s\S]+?)\*\// );

	if ( !configSourceMatch ) {
		return {};
	}

	return JSON.parse( configSourceMatch[ 1 ] );
}
